# Sales and package workspace refinement

This presentation-only increment is based on the reviewed quotation-recovery tree `24267f5872b8f22af75e0d0a34e1c9366b1da44d`.

## Intent

- Make Sales rows distinguish stage from the recorded follow-up date. A missing follow-up is a factual label, not an inferred priority.
- Keep quotation orientation visible: the current line-item total, the sequence of itinerary/prices → validity/terms → save, and a keyboard-accessible jump to the real validity field. This jump never saves, publishes or sends a quotation.
- Give unresolved recovery its relevant safe review/retry action rather than competing with New enquiry. All existing nonce, revision, scope and uncertain-outcome protections remain unchanged.
- Explain the independently saved public package snapshot and current private draft together, without inventing a published revision number or promising delivery to another application's cache.
- Give mobile editing more room by keeping consequential secondary actions separate from the measured sticky save rail. Keep their existing confirmations, permission and dirty/uncertain locks.
- Allow package controls to grow with enlarged text instead of clipping a native selector into a fixed height.

## Verification boundaries

The comparison uses identical synthetic fixture definitions and viewports against the pinned baseline and candidate. It is not a real-customer test, physical-device Safari certification, exhaustive browser zoom audit, or a claim that all CRM workflows are complete. Dedicated quotation-recovery CI remains required alongside the existing domain, security, accessibility, Chromium and Linux WebKit gates.

No API schema, database migration, encryption, role, environment, deployment or financial-write contract changes are included. Existing optimistic version checks are not an exactly-once guarantee. No VPS deployment is part of this increment.
