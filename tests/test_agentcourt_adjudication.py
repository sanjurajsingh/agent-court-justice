"""Dispute opening, consensus adjudication and Equivalence Principle behaviour."""

from genlayer_py.exceptions import GenLayerError
from gltest.assertions import tx_execution_succeeded, tx_execution_failed


from conftest import (
    AMOUNT,
    BPS,
    agreement,
    ctx,
    disagreeing_validators,
    disputed_agreement,
    delivered_agreement,
    funded_agreement,
    mocked_validators,
    new_agreement,
    verdict,
)

FIVE_PROVIDER = mocked_validators  # alias kept for readability in tests


def test_open_dispute_requires_live_escrow(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account).open_dispute(args=[aid, "not funded yet"]).transact()
    )

    aid2 = funded_agreement(court, client_account, provider_account)
    assert tx_execution_succeeded(
        court.connect(client_account).open_dispute(args=[aid2, "no delivery"]).transact()
    )
    assert agreement(court, aid2)["status"] == "DISPUTED"


def test_open_dispute_by_provider_after_delivery(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_succeeded(
        court.connect(provider_account)
        .open_dispute(args=[aid, "Client refuses to accept a conforming delivery."])
        .transact()
    )
    a = agreement(court, aid)
    assert a["status"] == "DISPUTED"
    assert "refuses" in a["dispute_reason"]


def test_open_dispute_rejects_stranger(court, client_account, provider_account, stranger_account):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(stranger_account).open_dispute(args=[aid, "meddling"]).transact()
    )
    assert agreement(court, aid)["status"] == "DELIVERED"


def test_adjudicate_requires_open_dispute(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account)
        .adjudicate(args=[aid])
        .transact(transaction_context=ctx(mocked_validators(3, verdict("CLIENT", BPS))))
    )


def test_adjudicate_produces_structured_verdict(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    receipt = court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(
            mocked_validators(5, verdict("CLIENT", BPS, "Endpoint 3 never returned 200."))
        )
    )
    assert tx_execution_succeeded(receipt)

    a = agreement(court, aid)
    assert a["status"] == "ADJUDICATED"
    d = a["decisions"][-1]
    assert d["winner"] in ("CLIENT", "PROVIDER", "SPLIT")
    assert 0 <= int(d["client_bps"]) <= BPS
    assert int(d["client_bps"]) + int(d["provider_bps"]) == BPS
    assert int(d["round"]) == 0
    assert d["reason"]
    assert d["decided_at"]


def test_full_client_win(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(5, verdict("CLIENT", BPS)))
    )
    d = agreement(court, aid)["decisions"][-1]
    assert d["winner"] == "CLIENT"
    assert int(d["client_bps"]) == BPS
    assert int(d["client_award"]) == AMOUNT
    assert int(d["provider_award"]) == 0


def test_full_provider_win(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    court.connect(provider_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(5, verdict("PROVIDER", 0)))
    )
    d = agreement(court, aid)["decisions"][-1]
    assert d["winner"] == "PROVIDER"
    assert int(d["provider_bps"]) == BPS
    assert int(d["provider_award"]) == AMOUNT
    assert int(d["client_award"]) == 0


def test_split_verdict_awards_are_proportional(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(5, verdict("SPLIT", 4000)))
    )
    d = agreement(court, aid)["decisions"][-1]
    assert d["winner"] == "SPLIT"
    assert int(d["client_bps"]) == 4000
    assert int(d["client_award"]) == AMOUNT * 4000 // BPS
    assert int(d["client_award"]) + int(d["provider_award"]) == AMOUNT


def test_verdict_bps_are_normalised_to_the_declared_winner(court, client_account, provider_account):
    """A leader claiming CLIENT but reporting 3000 bps must still award 100% to the client."""
    aid = disputed_agreement(court, client_account, provider_account)
    court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(5, verdict("CLIENT", 3000)))
    )
    d = agreement(court, aid)["decisions"][-1]
    assert int(d["client_bps"]) == BPS
    assert int(d["client_award"]) == AMOUNT


def test_malformed_verdict_is_rejected(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account)
        .adjudicate(args=[aid])
        .transact(transaction_context=ctx(mocked_validators(5, "I think the client is right.")))
    )
    assert agreement(court, aid)["status"] == "DISPUTED"


def test_invalid_winner_label_is_rejected(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account)
        .adjudicate(args=[aid])
        .transact(transaction_context=ctx(mocked_validators(5, verdict("NOBODY", 5000))))
    )


def test_validator_disagreement_blocks_the_verdict(court, client_account, provider_account):
    """Equivalence Principle: opposite winners must not reach consensus."""
    aid = disputed_agreement(court, client_account, provider_account)
    validators = disagreeing_validators(
        [
            verdict("CLIENT", BPS),
            verdict("PROVIDER", 0),
            verdict("PROVIDER", 0),
            verdict("CLIENT", BPS),
            verdict("PROVIDER", 0),
        ]
    )
    # No consensus: the transaction is never accepted. Depending on the node
    # this surfaces either as a failed receipt or as a client-side error.
    try:
        receipt = court.connect(client_account).adjudicate(args=[aid]).transact(
            transaction_context=ctx(validators)
        )
        assert tx_execution_failed(receipt)
    except GenLayerError:
        pass

    a = agreement(court, aid)
    assert a["status"] == "DISPUTED"
    assert a["decisions"] == []
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT



def test_split_within_tolerance_still_reaches_consensus(court, client_account, provider_account):
    """Same winner and a split inside the 500 bps tolerance must be accepted."""
    aid = disputed_agreement(court, client_account, provider_account)
    validators = disagreeing_validators(
        [
            verdict("SPLIT", 5000),
            verdict("SPLIT", 5000),
            verdict("SPLIT", 5200),
            verdict("SPLIT", 4900),
            verdict("SPLIT", 5000),
        ]
    )
    receipt = court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(validators)
    )
    assert tx_execution_succeeded(receipt)
    assert agreement(court, aid)["status"] == "ADJUDICATED"
