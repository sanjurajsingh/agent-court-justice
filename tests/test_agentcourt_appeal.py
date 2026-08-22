"""Appeal flow: bonds, one-round limit, re-adjudication and bond redistribution."""

from gltest.assertions import tx_execution_succeeded, tx_execution_failed

from conftest import (
    AMOUNT,
    APPEAL_BOND_BPS,
    BPS,
    agreement,
    balance_of,
    ctx,
    disputed_agreement,
    mocked_validators,
    verdict,
)

BOND = AMOUNT * APPEAL_BOND_BPS // BPS


def adjudicate_with(court, caller, aid, winner, bps, n=5):
    return court.connect(caller).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(n, verdict(winner, bps)))
    )


def test_appeal_requires_bond_and_adjudicated_state(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)

    # cannot appeal before there is a decision
    assert tx_execution_failed(
        court.connect(provider_account).appeal(args=[aid, "too early"]).transact(value=BOND)
    )

    adjudicate_with(court, client_account, aid, "CLIENT", BPS)

    # insufficient bond
    assert tx_execution_failed(
        court.connect(provider_account).appeal(args=[aid, "unfair"]).transact(value=BOND - 1)
    )
    assert agreement(court, aid)["status"] == "ADJUDICATED"


def test_appeal_accepts_bond_and_reopens_the_case(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)

    assert tx_execution_succeeded(
        court.connect(provider_account)
        .appeal(args=[aid, "CI logs prove all 3 endpoints returned 200."])
        .transact(value=BOND)
    )

    a = agreement(court, aid)
    assert a["status"] == "APPEALED"
    assert int(a["bond_pool"]) == BOND
    assert int(a["appeal_round"]) == 1
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT + BOND

    grounds = [e for e in court.get_evidence(args=[aid]).call() if "APPEAL GROUNDS" in e["statement"]]
    assert len(grounds) == 1
    assert grounds[0]["role"] == "PROVIDER"


def test_appeal_rejects_stranger(court, client_account, provider_account, stranger_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    assert tx_execution_failed(
        court.connect(stranger_account).appeal(args=[aid, "meddling"]).transact(value=BOND)
    )
    assert int(agreement(court, aid)["bond_pool"]) == 0


def test_second_appeal_is_rejected(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.connect(provider_account).appeal(args=[aid, "round 1"]).transact(value=BOND)
    adjudicate_with(court, provider_account, aid, "PROVIDER", 0)

    assert tx_execution_failed(
        court.connect(client_account).appeal(args=[aid, "round 2"]).transact(value=BOND)
    )
    assert int(agreement(court, aid)["appeal_round"]) == 1


def test_appeal_re_adjudication_records_round_one(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.connect(provider_account).appeal(args=[aid, "new evidence"]).transact(value=BOND)

    assert tx_execution_succeeded(adjudicate_with(court, provider_account, aid, "PROVIDER", 0))
    decisions = agreement(court, aid)["decisions"]
    assert len(decisions) == 2
    assert int(decisions[0]["round"]) == 0 and decisions[0]["winner"] == "CLIENT"
    assert int(decisions[1]["round"]) == 1 and decisions[1]["winner"] == "PROVIDER"


def test_successful_appeal_returns_bond_with_the_award(court, client_account, provider_account):
    """Provider appeals, wins, and receives escrow + its own bond back."""
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.connect(provider_account).appeal(args=[aid, "logs attached"]).transact(value=BOND)
    adjudicate_with(court, provider_account, aid, "PROVIDER", 0)

    provider_before = balance_of(provider_account)
    assert tx_execution_succeeded(court.settle(args=[aid]).transact())
    assert balance_of(provider_account) == provider_before + AMOUNT + BOND
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_frivolous_appeal_forfeits_the_bond(court, client_account, provider_account):
    """Provider appeals and loses: the bond goes to the client with the escrow."""
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.connect(provider_account).appeal(args=[aid, "nothing new"]).transact(value=BOND)
    adjudicate_with(court, provider_account, aid, "CLIENT", BPS)

    client_before = balance_of(client_account)
    assert tx_execution_succeeded(court.settle(args=[aid]).transact())
    assert balance_of(client_account) == client_before + AMOUNT + BOND
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_settle_is_blocked_while_an_appeal_is_open(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.connect(provider_account).appeal(args=[aid, "pending"]).transact(value=BOND)

    assert tx_execution_failed(court.settle(args=[aid]).transact())
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT + BOND
    assert agreement(court, aid)["settled"] is False


def test_appeal_after_settlement_is_rejected(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.settle(args=[aid]).transact()
    assert tx_execution_failed(
        court.connect(provider_account).appeal(args=[aid, "too late"]).transact(value=BOND)
    )
