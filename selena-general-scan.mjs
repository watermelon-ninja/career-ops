#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const portals = process.env.SELENA_GENERAL_PORTALS || path.join(root, 'config/selena-general-portals.yml');
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(root, 'scan-ats-full.mjs'), ...args], {
  cwd: root,
  env: { ...process.env, CAREER_OPS_PORTALS: portals },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
