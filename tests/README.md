# AgentCourt contract tests

Requires a running GenLayer Localnet (Docker) — start it first:

```bash
genlayer up          # localnet on http://127.0.0.1:4000/api
gltest               # run all 48 tests
gltest tests/test_agentcourt_adjudication.py -v
```

Lint / validate / typecheck the contract (GenLayer CLI toolchain):

```bash
genvm-lint check contracts/agentcourt.py
genvm-lint validate contracts/agentcourt.py
genvm-lint typecheck contracts/agentcourt.py
```

Suites:

- `test_agentcourt_lifecycle.py` — creation, escrow funding, delivery, evidence, happy path
- `test_agentcourt_adjudication.py` — disputes, verdict parsing, Equivalence Principle
- `test_agentcourt_settlement.py` — real native GEN payouts, idempotency, pot invariants
- `test_agentcourt_appeal.py` — bonds, one-round limit, bond redistribution

Only validator LLM output is mocked (`mock_llm_response`); all escrow accounting
and payouts are executed by the real contract and asserted against on-chain balances.
