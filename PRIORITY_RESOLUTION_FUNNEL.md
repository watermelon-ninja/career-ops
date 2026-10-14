# Priority Company Resolution Funnel

Goal: resolve the entire Priority Company pool by reusable technology layers, not company-by-company research.

## Exit gate
A company is only `resolved` when the pipeline has a machine-readable source that can retrieve job listings and full JD content. A visible careers/search page alone is not coverage.

## Funnel
1. `directory_alias` — full ATS directories + canonical aliases + verified configured boards
2. `ats_autodetect` — detect supported ATS from official careers URLs/redirects/page markers
3. `generic_endpoint` — probe reusable public job-search/JSON endpoints
4. `shared_platform_adapter` — add adapters only when one platform resolves multiple remaining companies (e.g. Oracle Recruiting Cloud / Phenom / Eightfold)
5. `manual_followup` — proprietary, blocked, unstable, or otherwise not worth custom engineering

## Per-company state
- name
- group
- stage
- status
- provider
- endpoint
- full_jd_verified
- attempts
- failure_reason

## Rules
- Process all unresolved companies through a layer before moving to the next layer
- Do not write a dedicated scraper while a reusable platform solution is possible
- Do not count a company as covered from a name match or visible careers page alone
- Failures never block the main ATS scanner
- Manual follow-up is an acceptable terminal state
