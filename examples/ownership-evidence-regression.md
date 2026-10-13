# Ownership-Evidence Regression Anchors

These anchors are **behavioral regression checks**, not a replacement scoring model.
They exist to catch false equivalence between matching keywords/domain exposure and
actual ownership. Candidate-specific anchors should normally stay private/local;
this file documents anonymized patterns only.

The numeric examples use a 10-point calibration scale. The production evaluator may
use another scale; preserve the **band and ordering invariants** rather than converting
these numbers mechanically.

| Anchor | Expected band | 10-point reference | Core direct evidence | Core gap / caution |
|---|---|---:|---|---|
| Enterprise integrations Product Owner | Top / direct | 9.2 | backlog, requirements, integrations, engineering/QA delivery | no material core ownership gap |
| Workflow Product Business Analyst | Top / direct | 9.3 | workflow, business rules, backlog, QA, stakeholder translation | no material core ownership gap |
| Technical Product Owner | Top / direct | 9.3 | technical PO, SQL/data, requirements, integrations | verify complete JD before treating exact score as authoritative |
| Data/forecast migration Product Manager | Strong | 8.6 | forecast-system migration, data integration, requirements, cross-functional delivery | independent commercial/product strategy is adjacent |
| Spares-planning Program Manager | Adjacent | 7.6 | enterprise systems, inventory/WMS context, cross-functional delivery | BOM/PO/spares operational ownership is not demonstrated |
| Supply-planning Program Manager | Adjacent | 7.3 | systems implementation, planning-system context, delivery | procurement, supplier and material-planning ownership is not demonstrated |
| SAP supply-chain consultant | Reject / material gap | 6.5 | supply-chain systems context, requirements/testing | hands-on SAP functional implementation/configuration is core and unsupported |
| CRM-platform Technical Product Owner | Reject / material gap | 6.3 | technical PO/BSA delivery is transferable | platform architecture/configuration/certification is core and unsupported |
| Developer-platform Technical Product Manager | Reject / material gap | 5.4 | technical delivery/product collaboration | SDK/API/framework developer-platform ownership is core and unsupported |
| Robotics/infrastructure deployment Program Manager | Reject / material gap | 6.4 | program delivery and cross-functional coordination | robotics/infrastructure engineering deployment ownership is core and unsupported |

## Regression assertions

1. Top/direct enterprise-systems PO/BSA anchors must rank above planning-operations,
   specialist-platform, and engineering-deployment anchors when the candidate has
   direct systems-delivery evidence.
2. A role must not enter top/direct territory because its title contains Product Owner,
   Program Manager, Supply Chain, SAP, forecasting, inventory, or similar matching terms.
3. Planning roles with core BOM, PO, procurement, supplier, material-planning, or
   operational-planning ownership remain Adjacent unless direct evidence exists.
4. Specialist platform roles requiring hands-on configuration, architecture,
   certification, or module implementation cannot be upgraded by generic enterprise
   systems exposure.
5. Different industry/domain alone must not downgrade a role when the underlying
   systems-delivery function is directly demonstrated.
6. Program Manager must be interpreted by subtype. Systems/transformation/technical
   delivery may be strong; procurement, operations, infrastructure, construction, or
   robotics PM work requires separate ownership evidence.
7. Preferred-qualification gaps must not be treated like minimum/core requirement gaps.
8. If the full JD is unavailable or unverified, reduce score confidence rather than
   inventing missing requirements.

## How to use these anchors

After evaluating a new JD, compare the result with the nearest anchor pattern. If the
new result violates an assertion above, re-check the Direct / Adjacent / Gap / Unknown
mapping and the ownership test before finalizing the score.

Do not force every role into one of these examples. They are guardrails for obvious
miscalibration, not a lookup table or additive point system.


## Calibration smoke-test results

These checks validate the intended behavior of the ownership layer against the
reference anchors above. They are not fresh independent JD reviews.

| Test | Expected behavior | Result |
|---|---|---|
| Enterprise integrations PO | Direct systems ownership should remain top/direct | PASS |
| Workflow/Product BA | Requirements + workflow + QA ownership should remain top/direct | PASS |
| Spares-planning PM | Shared supply-chain vocabulary must not erase BOM/PO ownership gaps | PASS |
| Supply-planning PM | Planning-system exposure must not become procurement/material-planning ownership | PASS |
| SAP supply-chain consultant | SAP exposure must not become hands-on module/configuration expertise | PASS |
| CRM Technical PO | Generic Technical PO strength must not erase a required specialist-platform gap | PASS |
| Developer-platform TPM | Matching product/technical title must not substitute for SDK/framework ownership | PASS |
| Infrastructure/robotics PM | Generic program delivery must not substitute for engineering-deployment ownership | PASS |

### Ordering check

Expected qualitative ordering:

`direct enterprise-systems PO/BSA > adjacent planning/operations roles > specialist roles with unsupported core requirements`

Result: **PASS** under the Evidence & Ownership Calibration rules.

### Remaining validation needed

The smoke test validates the rule behavior, not numerical score reproducibility.
Before treating an exact numeric score as regression-tested, run the evaluator against
a complete verified JD and the candidate's private profile/CV. Where a historical JD
is incomplete or unverified, test the expected band and ownership classification only.


## False-negative guardrails

Ownership calibration must prevent inflated matches **without becoming a gap-only
filter**. A candidate with direct enterprise-systems delivery experience can be a
strong match even when the employer's industry, business domain, or role title differs.

### Positive-transfer anchors

| Pattern | Expected behavior | Why |
|---|---|---|
| Enterprise Business Analyst in a different industry | Strong/top when the core work is requirements, process analysis, technical specifications, workshops, testing, training, and business/developer translation | These are direct BSA/system-delivery functions; industry difference alone is not a core gap |
| Enterprise transformation / systems implementation PM | Strong when the role centers on requirements, implementation planning, cross-functional technical delivery, testing/readiness, go-live, and issue resolution | The underlying delivery ownership transfers even if the platform or business domain changes |
| Technical Product Owner for enterprise workflows/integrations | Top/direct when backlog, requirements, prioritization, acceptance criteria, integrations, QA/release coordination are core | Technical PO ownership is direct; do not require supply-chain keywords |
| BI / analytics systems role | Strong when SQL, reporting, data migration/integration, business-facing analytics, exception monitoring, and stakeholder translation are core | Direct analytics-systems evidence should outweigh an unrelated industry label |
| Supply-chain systems role | Top/direct when the job owns WMS/planning-system implementation, integrations, requirements, testing, or systems transformation | Supply chain is useful domain context here because the **function** is also direct |

### False-negative assertions

1. Do not require `supply chain` in the title or JD for a high score.
2. Do not penalize a different industry twice: once in domain fit and again in Match CV
   when the underlying core function is direct.
3. A missing employer-specific platform is not automatically a material gap when the JD
   asks for general enterprise-system delivery and treats that platform as preferred or
   learnable rather than a hands-on minimum.
4. Business Analyst roles should be scored on the actual BA work requested. Requirements
   workshops, process flows, system specifications, testing, training, and developer
   translation are direct evidence categories, not generic transferable soft skills.
5. Technical Program/Project Manager roles should receive full credit for direct
   implementation/delivery ownership when engineering-specialist or operations-specialist
   ownership is not itself a core requirement.
6. Product roles centered on technical delivery, workflow, integrations, backlog, and
   execution should not be downgraded merely because the candidate has less commercial
   product strategy experience. Only penalize commercial strategy when it is actually
   core to the JD.
7. Domain adjacency should become a material penalty only when the JD requires domain
   ownership, regulated expertise, specialist execution, or a minimum qualification that
   the candidate does not have.

### Bidirectional sanity check

Before finalizing a match, ask both questions:

1. **Inflation check:** Did matching titles, tools, keywords, or adjacent domain exposure
   get mistaken for direct ownership?
2. **Suppression check:** Did a different title, industry, or domain hide direct evidence
   that the candidate has already performed the underlying core work?

A calibrated result must pass **both** checks.


## Positive-transfer smoke test: Enterprise Business Analyst

Reference pattern: a government/enterprise Business Analyst role whose core duties include
business-process and system analysis, translating business requirements into technical
specifications, requirements workshops, process improvement, test plans/scenarios,
reviews/training, and acting as the business-to-developer bridge.

Expected classification from confirmed candidate evidence:

| Core function | Expected evidence |
|---|---|
| Business process / system analysis | Direct |
| Requirements gathering and documentation | Direct |
| Translate business needs into technical specifications | Direct |
| Business-to-developer translation | Direct |
| Requirements workshops / stakeholder facilitation | Direct |
| Test plans, scenarios, SIT/UAT-style validation | Direct |
| Process-flow documentation / improvement | Direct |
| Reviews, readiness, and user-facing training/support | Direct to Adjacent depending on JD depth |
| Government/regulated mission domain | Adjacent or Unknown; do not treat industry difference alone as a core gap |

**Expected fit band from responsibilities alone: Strong to Top.**

This test intentionally does **not** assign an exact numeric score unless the complete
minimum qualifications, clearance/citizenship requirements, location constraints, and
other mandatory conditions are available. Missing JD sections reduce confidence; they
must not be invented.

Regression assertion: this pattern must score materially above planning-operations or
specialist-platform roles with unsupported core ownership requirements. If it does not,
the evaluator is over-penalizing domain/title differences and failing the suppression check.
