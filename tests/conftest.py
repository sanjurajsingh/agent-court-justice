"""
Shared fixtures/helpers for the AgentCourt gltest suite.

Nothing here mocks the contract's money logic: escrow, awards and payouts are
always executed by the real Intelligent Contract on the network and asserted
against real native GEN balances. The only thing mocked is the validators' LLM
output, which is required to make the non-deterministic adjudication step
deterministic and to exercise the Equivalence Principle (agreement vs.
disagreement) on purpose.
"""

import json
from pathlib import Path

import pytest
from gltest import get_contract_factory
from gltest.accounts import get_accounts
from gltest.clients import get_gl_client
from gltest.validators import get_validator_factory

CONTRACT_NAME = "AgentCourt"
CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "agentcourt.py"

# money constants (wei)
GEN = 10**18
AMOUNT = 10**17  # 0.1 GEN escrow used by most tests
BPS = 10000
APPEAL_BOND_BPS = 1000

# distinctive substring of _ADJUDICATION_PROMPT used to key the mocked answer
PROMPT_KEY = "You are an impartial arbitrator"

TERMS = (
    "Provider delivers a working REST API with 3 endpoints and an OpenAPI spec "
    "before the deadline. Client pays 0.1 GEN held in escrow."
)
CRITERIA = (
    "All 3 endpoints return HTTP 200 for the documented happy path and the "
    "OpenAPI spec validates."
)


def verdict(winner: str, client_bps: int, reason: str = "Decided from the evidence.") -> str:
    """Raw LLM answer the contract must be able to parse."""
    return json.dumps({"winner": winner, "client_bps": client_bps, "reason": reason})


def mocked_validators(count: int, response: str):
    """`count` identical validators that all return the same verdict."""
    factory = get_validator_factory()
    return [
        v.to_dict()
        for v in factory.batch_create_mock_validators(
            count,
            mock_llm_response={"nondet_exec_prompt": {PROMPT_KEY: response}},
        )
    ]


def disagreeing_validators(responses):
    """One validator per response — used to break the Equivalence Principle."""
    factory = get_validator_factory()
    return [
        factory.create_mock_validator(
            mock_llm_response={"nondet_exec_prompt": {PROMPT_KEY: r}}
        ).to_dict()
        for r in responses
    ]


def ctx(validators):
    return {"validators": validators}


@pytest.fixture(scope="session")
def client_account():
    return get_accounts()[1]


@pytest.fixture(scope="session")
def provider_account():
    return get_accounts()[2]


@pytest.fixture(scope="session")
def stranger_account():
    return get_accounts()[3]


@pytest.fixture
def factory():
    return get_contract_factory(contract_file_path=CONTRACT_PATH)


@pytest.fixture
def court(factory, client_account):
    """A freshly deployed AgentCourt, connected as the CLIENT."""
    return factory.deploy(args=[], account=client_account)


@pytest.fixture
def gl():
    return get_gl_client()


def balance_of(account) -> int:
    return get_gl_client().get_balance(account.address)


def new_agreement(court, client_account, provider_account, amount: int = AMOUNT) -> int:
    """create + read back the id (next_id - 1)."""
    as_client = court.connect(client_account)
    as_client.create_agreement(
        args=[provider_account.address, TERMS, CRITERIA, amount]
    ).transact()
    return int(court.get_next_id(args=[]).call()) - 1


def funded_agreement(court, client_account, provider_account, amount: int = AMOUNT) -> int:
    aid = new_agreement(court, client_account, provider_account, amount)
    court.connect(client_account).fund_escrow(args=[aid]).transact(value=amount)
    return aid


def delivered_agreement(court, client_account, provider_account, amount: int = AMOUNT) -> int:
    aid = funded_agreement(court, client_account, provider_account, amount)
    court.connect(provider_account).submit_deliverable(
        args=[aid, "ipfs://deliverable-1", "API deployed, spec attached."]
    ).transact()
    return aid


def disputed_agreement(court, client_account, provider_account, amount: int = AMOUNT) -> int:
    aid = delivered_agreement(court, client_account, provider_account, amount)
    court.connect(client_account).open_dispute(
        args=[aid, "Only 2 of 3 endpoints work and the spec does not validate."]
    ).transact()
    return aid


def agreement(court, aid: int) -> dict:
    return court.get_agreement(args=[aid]).call()
