# Priority Multi-Source Discovery Waterfall

Career-Ops optimizes for **30 new satisfactory jobs per day**, not 354/354 ATS engineering coverage.

## Priority-company lane

Run all priority companies through progressively more expensive sources. A company or job exits the waterfall as soon as enough job-level evidence is available.

1. **Official ATS/API** — Workday CXS, Greenhouse, Lever, Ashby, supported structured feeds
2. **Official careers/job-detail pages** — direct public company pages
3. **LinkedIn Jobs** — discovery and JD recovery using company + exact title + location + IDs
4. **Indeed** — discovery and JD recovery with cross-source identity matching
5. **Jobright / other aggregators** — discovery/recovery only; verify freshness and identity
6. **Public web** — exact-title + company + requisition/job-ID search
7. Only after all applicable sources fail: `jd_unresolved`

## Batch funnel

Do not process one company through all seven sources before moving on.

- Pass A: all priority companies through official ATS/API
- Pass B: unresolved companies/jobs through official careers pages
- Pass C: remaining through LinkedIn
- Pass D: remaining through Indeed
- Pass E: remaining through aggregators
- Pass F: remaining through public web

Each layer receives fewer unresolved candidates.

## Job identity / dedupe

Prefer:
1. company + official requisition/job ID
2. company + ATS job ID
3. normalized company + exact title + location

LinkedIn/Indeed/aggregator IDs are source-specific aliases and must not automatically be treated as official requisition IDs.

Persist every processed identity so a previously surfaced/scored/rejected job is not presented as new again.

## JD Read Gate

A source is useful only when it yields a specific job and substantive job-description content.

`full` requires enough job-level content to evaluate the role, including responsibility/duty signals and qualification/requirement signals.

Careers landing pages, search-result pages, platform detection, title/location metadata, snippets, and whole-page HTML shells do **not** pass.

Only `jd_fetch_status=full` may set:
- `full_jd_verified=true`
- `fit_scoring_eligible=true`

Store `jd_source`, `jd_source_url`, `jd_verified_at`, and source-specific IDs.

## Daily discovery / scoring loop

1. Give all priority companies a discovery pass before general-universe early stop
2. Build up to 300 new potential jobs per discovery round
3. Cheap-filter general-universe jobs by title/location/seniority/freshness; keep priority-company title filtering permissive
4. Rank by Fetch Priority (never Selena Fit)
5. Fetch/verify JD in batches of 50 using the source waterfall
6. Full JD -> relevance -> Selena Fit
7. Stop once 30 **new-to-Selena satisfactory/high-fit jobs** are reached
8. If the round is insufficient, discover another round excluding processed identities

## Coverage debt

ATS/platform engineering is an optimization, not a prerequisite. Log failures by source/provider/reason. Build a reusable adapter when repeated failures materially reduce daily job yield; rare proprietary failures may remain terminal fallback/manual cases.
