# AgentCourt contract tests

No Docker required — the suite runs against **GLSim** (`genlayer-test[sim]`),
a local JSON-RPC node on `http://127.0.0.1:4000/api`.

```bash
./scripts/run-contract-tests.sh            # setup + GLSim (5 validators) + all tests
./scripts/run-contract-tests.sh tests/test_agentcourt_settlement.py -v
```

The script installs `genlayer-test[sim]` into `~/glenv`, applies
`tools/glsim_patch.py` (GLSim gaps: native value plumbing, `emit_transfer`
payouts, contract-class cache, per-validator LLM mocks, in-place storage
rollback on failed consensus), starts GLSim and runs `gltest`.

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
