# AgentCourt contract tests

No Docker required — the suite runs against **GLSim** (`genlayer-test[sim]`),
a local JSON-RPC node on `http://127.0.0.1:4000/api`.

```bash
./scripts/run-contract-tests.sh            # setup + GLSim (5 validators) + all tests
./scripts/run-contract-tests.sh tests/test_agentcourt_settlement.py -v
```

Prerequisites are Bash, `curl`, and Python 3.10+ with `venv` support. The same
command works on macOS and Linux; `GLSIM_VENV`, `GLSIM_PORT`, and `GLSIM_LOG`
may be set to override their defaults.

The script creates or reuses `~/glenv`, installs `genlayer-test[sim]` and NumPy
when missing, applies
`tools/glsim_patch.py` (GLSim gaps: native value plumbing, `emit_transfer`
payouts, contract-class cache, per-validator LLM mocks, in-place storage
rollback on failed consensus), downloads the pinned runner with checked errors,
starts GLSim with five validators, waits for readiness, runs `gltest`, and then
stops only the GLSim process it started. No GNU-only tools or Docker are used.

Suites:

- `test_agentcourt_lifecycle.py` — creation, escrow funding, delivery, evidence, happy path
- `test_agentcourt_adjudication.py` — disputes, verdict parsing, Equivalence Principle
- `test_agentcourt_settlement.py` — real native GEN payouts, idempotency, pot invariants
- `test_agentcourt_appeal.py` — bonds, one-round limit, bond redistribution

Only validator LLM output is mocked (`mock_llm_response`); all escrow accounting
and payouts are executed by the real contract and asserted against on-chain balances.

`genvm-lint` is not published to PyPI and is not installable in this
environment; the contract is validated by `py_compile` plus real deployment and
schema extraction on every test run.
