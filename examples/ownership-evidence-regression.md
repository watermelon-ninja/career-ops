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
