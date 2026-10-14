# Priority Multi-Source Discovery + JD Recovery

Career-Ops optimizes for **30 new satisfactory jobs per day**, not 354/354 ATS engineering coverage.

## 1. Discovery is a multi-source UNION

For every priority company, discovery sources are complementary and should be queried independently. A successful source must **not** prevent the other discovery sources from running.

Discovery sources:

1. **Official ATS/API** — Workday CXS, Greenhouse, Lever, Ashby, supported structured feeds
2. **Official company careers search/listings** — public company job inventory/search pages
3. **LinkedIn Jobs** — company job inventory/search
4. **Indeed** — company/job inventory/search
5. **Jobright / other aggregators** — additional inventory/discovery
6. **Public web search** — supplementary discovery, especially exact company/domain/job searches

Then:

`source inventories -> UNION -> job identity matching -> dedupe -> candidate pool`

A job discovered by any one source is eligible to enter the candidate pool. Discovery is **not** a fallback waterfall.

### Why

Each source can contain jobs missing from the others. We cannot recover a JD for a job whose existence was never discovered, so inventory coverage comes before JD recovery.

For priority companies, title filtering must remain permissive because generic titles can hide supply-chain/system relevance. Only obviously irrelevant roles should be cheaply excluded before JD retrieval.

## 2. Job identity / persistent dedupe

Prefer:
1. company + official requisition/job ID
2. company + ATS job ID
3. normalized company + exact title + location

LinkedIn/Indeed/aggregator IDs are source-specific aliases and must not automatically be treated as official requisition IDs.

Merge source aliases/URLs into one canonical job record. Persist every processed identity so a previously surfaced, scored, rejected, or JD-read job is not presented as new again.

## 3. JD retrieval IS a waterfall

Once a job is known to exist, recover its substantive JD from the cheapest/most authoritative available source and stop when a credible full JD is obtained:

1. official ATS job-detail/API
2. official company job-detail page
3. LinkedIn job detail
4. Indeed job detail
5. Jobright / aggregator job detail
6. public indexed copy/search result

Failure at one JD source moves the **known job** to the next retrieval source. This is separate from discovery.

Store `jd_source`, `jd_source_url`, `jd_verified_at`, official/source-specific IDs, and cross-source aliases.

## 4. JD Read Gate

A source passes only when it yields substantive **job-level** description content sufficient to evaluate the role, including responsibility/duty signals and qualification/requirement signals.

Careers landing pages, search-result pages, platform detection, title/location metadata, snippets, and whole-page HTML shells do **not** pass.

Only `jd_fetch_status=full` may set:
- `full_jd_verified=true`
- `fit_scoring_eligible=true`

## 5. Daily discovery / scoring loop

1. Run all available discovery sources for the priority-company universe and union their inventories
2. Cross-source identity match and persistent-dedupe before expensive JD work
3. Give priority-company jobs a permissive cheap eligibility pass
4. Combine with general-universe discovery and build up to 300 new potential jobs per round
5. Rank by Fetch Priority (never Selena Fit)
6. Recover/verify JD in batches of 50 using the JD retrieval waterfall
7. Full JD -> relevance -> Selena Fit
8. Stop once 30 **new-to-Selena satisfactory/high-fit jobs** are reached
9. If insufficient, discover another round excluding processed identities

Priority-company discovery must receive its guaranteed pass before general-universe early stopping can end the daily run.

## 6. Source contribution metrics

Track per source:
- jobs discovered
- unique jobs contributed after union/dedupe
- full JDs recovered
- unique satisfactory/high-fit jobs ultimately produced
- stale/duplicate/failure rate

This measures whether LinkedIn, Indeed, Jobright, public search, or an ATS adapter materially improves real job yield.

## 7. Coverage debt

ATS/platform engineering is an optimization, not a prerequisite. Log failures by source/provider/reason. Build a reusable adapter when repeated failures materially reduce daily job yield; rare proprietary failures may remain terminal fallback/manual cases.

**Key distinction:** Discovery maximizes recall through parallel complementary sources. JD retrieval minimizes cost through ordered stop-on-success fallback.
