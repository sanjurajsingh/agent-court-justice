# Steward blocker remediation

## Scope
Change only evidence validation/authenticity and the cross-platform contract test runner. Leave settlement, deadlines, transaction finality, and unrelated UI behavior unchanged.

## Contract evidence rules
- Require a normalized SHA-256 digest before any fetched external item can receive `VALIDATED`; an allowlisted URI without a digest remains an unverified assertion and is not fetched or counted as validated.
- Keep deterministic byte retrieval and SHA-256 comparison: matching bytes become content-verified, mismatch becomes `INVALID`, and retrieval failure becomes `UNAVAILABLE`.
- Separate content integrity from issuer authenticity in each adjudication evidence record with explicit fields for content-hash verification, issuer verification, issuer identity/source, and overall validation status.
- Derive issuer identity deterministically only from canonical HTTPS namespaces that bind an account in their URL (GitHub raw, gist, and supported GitHub API repository paths). Treat IPFS, generic gateways, Arweave, and the GenLayer test server as content-verifiable but not issuer-authenticated unless their source itself supplies a deterministic issuer binding.
- Update adjudication instructions so content-verified evidence is never described as issuer-authenticated unless the issuer rule passes.
- Expose the resulting verification counts/metadata through the smallest necessary contract structures and read responses; update matching client types only if the public schema changes.

## Regression coverage
Add focused tests proving:
- allowlisted URI without a hash is not validated;
- correct hash verifies content;
- wrong hash is invalid;
- a canonical issuer-bound source verifies its issuer;
- a content-addressed source can verify content while issuer remains unverified;
- adjudication receives and records the exact status and verification flags.

Preserve all existing lifecycle, deadline, appeal, settlement, and finality tests.

## Portable one-command runner
- Keep the documented executable Bash entry point, but remove Linux-only process launching (`setsid`) and make cleanup portable with a PID file/trap rather than broad process killing.
- Detect a usable Python 3 interpreter, `curl`, and venv support with clear remediation messages.
- Create/reuse a configurable virtual environment, install/verify `genlayer-test[sim]` and required dependencies using that environment’s Python, download the runner artifact with failure reporting, and wait for GLSim readiness with a clear timeout/log tail.
- Use repository-root absolute paths and macOS/Linux-compatible shell commands throughout.
- Update the test README to document prerequisites and the portable behavior.

## Verification and report
Run Python compilation and the complete five-validator GLSim suite through `./scripts/run-contract-tests.sh`. Report only the requested file list, exact rules, issuer mechanism, schema/redeploy impact, runner fix, and final pass/fail count.
