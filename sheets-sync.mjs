#!/usr/bin/env node

/**
 * sheets-sync.mjs — Minimal Google Sheets tracker sync
 *
 * Reads jobs from data/pipeline.md and data/applications.md, then upserts them
 * into the first tab of the configured Google Sheet. The official job link is
 * the primary dedup key. Existing rows only get Last Seen refreshed so
 * user-owned tracker columns remain untouched.
 */

import 'dotenv/config';
import { createSign } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';

const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const SCAN_LOG_SHEET = 'Career-Ops Scan Log';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

const SCAN_LOG_HEADERS = [
  'Official Link',
  'First Seen',
  'Last Seen',
  'Source',
  'Company',
  'Role',
  'Location',
  'Scan Status',
  'JD Review Status',
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUrl(url) {
  return String(url || '')
    .trim()
    .replace(/[)>\].,;]+$/g, '')
    .replace(/\/$/, '');
}

function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s|)\]>]+/);
  return match ? normalizeUrl(match[0]) : '';
}

function splitMarkdownRow(line) {
  return line.split('|').map((part) => part.trim());
}

function parseReportPath(reportCell) {
  const match = String(reportCell || '').match(/\(([^)]+\.md)\)/);
  return match ? match[1] : '';
}

function readReportUrl(reportCell) {
  const reportPath = parseReportPath(reportCell);
  if (!reportPath || !existsSync(reportPath)) return '';

  const text = readFileSync(reportPath, 'utf8');
  const urlLine = text.split('\n').find((line) => /^\*\*URL:\*\*/i.test(line.trim()));
  return extractFirstUrl(urlLine || '');
}

function parseScanHistory() {
  if (!existsSync(SCAN_HISTORY_PATH)) return [];
  const lines = readFileSync(SCAN_HISTORY_PATH, 'utf8').split('\n').filter(Boolean);
  const jobs = [];
  for (const line of lines.slice(1)) {
    const [url, firstSeen, source, role, company, status, location] = line.split('\t');
    if (!url) continue;
    jobs.push({ officialLink: normalizeUrl(url), firstSeen, source, company, role, location, scanStatus: status || 'added' });
  }
  return jobs;
}

function parsePipelineJobs() {
  if (!existsSync(PIPELINE_PATH)) return [];

  const jobs = [];
  const lines = readFileSync(PIPELINE_PATH, 'utf8').split('\n');

  for (const line of lines) {
    const url = extractFirstUrl(line);
    if (!url) continue;

    const withoutCheckbox = line.replace(/^\s*[-*]\s*\[[ xX-]?\]\s*/, '').trim();
    const parts = withoutCheckbox.split('|').map((part) => part.trim());
    const urlPart = extractFirstUrl(parts[0] || line);

    jobs.push({
      officialLink: urlPart || url,
      source: 'pipeline',
      company: parts[1] || '',
      role: parts[2] || '',
      score: '',
      pdf: '',
      report: '',
    });
  }

  return jobs;
}

function parseApplicationJobs() {
  if (!existsSync(APPLICATIONS_PATH)) return [];

  const jobs = [];
  const lines = readFileSync(APPLICATIONS_PATH, 'utf8').split('\n');

  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*#\s*\|/i.test(line)) continue;
    if (/^\|\s*-+\s*\|/.test(line)) continue;

    const parts = splitMarkdownRow(line);
    if (parts.length < 10) continue;

    const num = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(num)) continue;

    const report = parts[8] || '';
    const notes = parts[9] || '';
    const officialLink = readReportUrl(report) || extractFirstUrl(notes);

    if (!officialLink) continue;

    jobs.push({
      officialLink,
      source: 'applications',
      company: parts[3] || '',
      role: parts[4] || '',
      score: parts[5] || '',
      pdf: parts[7] || '',
      report,
    });
  }

  return jobs;
}

function dedupeJobs(jobs) {
  const byLink = new Map();
  for (const job of jobs) {
    const key = normalizeUrl(job.officialLink).toLowerCase();
    if (!key) continue;

    const existing = byLink.get(key);
    if (!existing) {
      byLink.set(key, { ...job, officialLink: normalizeUrl(job.officialLink) });
      continue;
    }

    byLink.set(key, {
      ...existing,
      ...Object.fromEntries(Object.entries(job).filter(([, value]) => value)),
      officialLink: existing.officialLink,
      source: existing.source === job.source ? existing.source : `${existing.source}, ${job.source}`,
    });
  }
  return [...byLink.values()];
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON in .env');

  const value = raw.trim();
  if (existsSync(value)) return JSON.parse(readFileSync(value, 'utf8'));

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(String(serviceAccount.private_key).replace(/\\n/g, '\n'))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google auth failed (${response.status}): ${await response.text()}`);
  }

  const json = await response.json();
  return json.access_token;
}

async function sheetsRequest(accessToken, path, options = {}) {
  const response = await fetch(`${SHEETS_API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Google Sheets API failed (${response.status}): ${await response.text()}`);
  }

  return response.status === 204 ? null : response.json();
}

function escapeSheetName(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function headerIndex(headers, name) {
  const wanted = name.toLowerCase();
  return headers.findIndex((header) => String(header).trim().toLowerCase() === wanted);
}

function linkColumnIndex(headers) {
  for (const name of ['Official Link', 'URL', 'Link']) {
    const idx = headerIndex(headers, name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function makeScanLogRow(job, date) {
  const values = {
    'Official Link': job.officialLink,
    'First Seen': job.firstSeen || date,
    'Last Seen': date,
    Source: job.source || '',
    Company: job.company || '',
    Role: job.role || basename(job.officialLink),
    Location: job.location || '',
    'Scan Status': job.scanStatus || 'discovered',
    'JD Review Status': '',
  };
  return SCAN_LOG_HEADERS.map((header) => values[header] || '');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const date = today();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId && !dryRun) throw new Error('Missing GOOGLE_SHEET_ID in .env');

  const jobs = dedupeJobs([...parseScanHistory(), ...parsePipelineJobs(), ...parseApplicationJobs()]);
  console.log(`Found ${jobs.length} unique discovered job(s).`);

  if (dryRun) {
    for (const job of jobs) console.log(`- ${job.officialLink} | ${job.company || '(unknown company)'} | ${job.role || '(unknown role)'}`);
    console.log('Dry run complete; Google Sheets was not modified.');
    return;
  }

  const serviceAccount = parseServiceAccount();
  const accessToken = await getAccessToken(serviceAccount);
  const spreadsheet = await sheetsRequest(accessToken, `${spreadsheetId}?fields=sheets(properties(sheetId,title))`);
  const sheet = spreadsheet.sheets?.map(s => s.properties).find(s => s.title === SCAN_LOG_SHEET);
  if (!sheet) throw new Error(`Missing dedicated sheet tab: ${SCAN_LOG_SHEET}. Existing tracker tabs are intentionally not modified.`);

  const escapedSheetName = escapeSheetName(SCAN_LOG_SHEET);
  const values = await sheetsRequest(accessToken, `${spreadsheetId}/values/${encodeURIComponent(`${escapedSheetName}!A1:I10000`)}`);
  const rows = values.values || [];
  const headers = rows[0] || [];
  if (SCAN_LOG_HEADERS.some((h, i) => headers[i] !== h)) {
    throw new Error(`${SCAN_LOG_SHEET} headers do not match expected schema; refusing to modify tracker layout.`);
  }

  const existingByLink = new Map();
  rows.slice(1).forEach((row, index) => {
    const link = normalizeUrl(row[0]).toLowerCase();
    if (link) existingByLink.set(link, { rowNumber: index + 2, row });
  });

  const updates = [], appends = [];
  for (const job of jobs) {
    const key = normalizeUrl(job.officialLink).toLowerCase();
    const existing = existingByLink.get(key);
    if (existing) updates.push({ rowNumber: existing.rowNumber });
    else appends.push(makeScanLogRow(job, date));
  }

  if (updates.length) {
    await sheetsRequest(accessToken, `${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates.map(({rowNumber}) => ({
        range: `${escapedSheetName}!C${rowNumber}`, values: [[date]]
      })) }),
    });
  }
  if (appends.length) {
    await sheetsRequest(accessToken, `${spreadsheetId}/values/${encodeURIComponent(`${escapedSheetName}!A:I`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: appends }),
    });
  }

  console.log(`Synced discovery audit log only to ${SCAN_LOG_SHEET}.`);
  console.log(`Updated Last Seen: ${updates.length}`);
  console.log(`Appended new rows: ${appends.length}`);
  console.log('Existing tabs 岗位候选 / 20个能力高契合候选 / 已投递或关闭 / 排除与暂停 / Resume Pool were not modified.');
}

main().catch((error) => {
  console.error(`sheets-sync failed: ${error.message}`);
  process.exit(1);
});
