# Final Studionet verification

## Scope
- Query the new Studionet deployment directly and compare its live schema and readable state with the locally tested AgentCourt contract.
- Verify each requested evidence-integrity, issuer-binding, and decision-metadata field from live schema/code evidence.
- Run non-destructive live evidence-state checks where the deployed contract exposes a safe read path; do not simulate or submit transactions.
- Replace the configured contract address and confirm the app, including the verification page, has no old deployment references.
- Run TypeScript validation and the production build, then report a strict PASS/FAIL checklist and any remaining resubmission blocker.

## Technical details
- Keep the address environment-driven; no contract behavior or unrelated interface changes.
- Treat a smoke state as PASS only when observed from the live deployment. If no existing evidence can exercise a case and a write would be required, report it as FAIL rather than claiming verification.
