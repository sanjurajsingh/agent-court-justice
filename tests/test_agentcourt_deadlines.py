"""Deadlines: delivery expiry, dispute window, refunds and race protection.

Time is controlled with the transaction context's `genvm_datetime`, which is
the deterministic clock every validator sees. No balances are simulated: every
refund/release below is a real native GEN transfer by the contract.
"""

from gltest.assertions import tx_execution_failed, tx_execution_succeeded

from conftest import (
    AMOUNT,
    BPS,
    DELIVERY_WINDOW,
    DISPUTE_WINDOW,
    MIN_WINDOW,
    agreement,
    at,
    balance_of,
    ctx,
    delivered_agreement,
    disputed_agreement,
    funded_agreement,
    mocked_validators,
    new_agreement,
    verdict,
)

AFTER_DELIVERY = DELIVERY_WINDOW + 600
AFTER_DISPUTE = DELIVERY_WINDOW + DISPUTE_WINDOW + 600


def test_windows_are_recorded_and_validated(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    a = agreement(court, aid)
    assert int(a["delivery_window"]) == DELIVERY_WINDOW
    assert int(a["dispute_window"]) == DISPUTE_WINDOW
    assert int(a["delivery_deadline"]) == 0  # clock starts at funding

    court.connect(client_account).fund_escrow(args=[aid]).transact(value=AMOUNT)
    a = agreement(court, aid)
    assert int(a["delivery_deadline"]) == int(a["funded_ts"]) + DELIVERY_WINDOW


def test_out_of_range_windows_are_rejected(court, client_account, provider_account):
    for dw, pw in ((0, DISPUTE_WINDOW), (10**9, DISPUTE_WINDOW), (MIN_WINDOW, 1), (MIN_WINDOW, 10**9)):
        assert tx_execution_failed(
            court.connect(client_account)
            .create_agreement(
                args=[provider_account.address, "terms", "criteria", AMOUNT, dw, pw]
            )
            .transact()
        )


def test_delivery_after_deadline_is_rejected(court, client_account, provider_account):
    aid = funded_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(provider_account)
        .submit_deliverable(args=[aid, "", "late", ""])
        .transact(transaction_context=at(AFTER_DELIVERY))
    )
    assert agreement(court, aid)["status"] == "FUNDED"


def test_client_recovers_escrow_after_delivery_deadline(court, client_account, provider_account):
    aid = funded_agreement(court, client_account, provider_account)
    assert tx_execution_failed(  # not yet expired
        court.connect(client_account).claim_expiry(args=[aid]).transact()
    )

    before = balance_of(client_account)
    assert tx_execution_succeeded(
        court.connect(client_account)
        .claim_expiry(args=[aid])
        .transact(transaction_context=at(AFTER_DELIVERY))
    )
    assert balance_of(client_account) > before
    a = agreement(court, aid)
    assert a["status"] == "EXPIRED"
    assert a["refunded"] is True
    assert int(a["paid_out"]) == AMOUNT
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_expiry_refund_cannot_be_claimed_twice(court, client_account, provider_account):
    aid = funded_agreement(court, client_account, provider_account)
    court.connect(client_account).claim_expiry(args=[aid]).transact(
        transaction_context=at(AFTER_DELIVERY)
    )
    before = balance_of(client_account)
    assert tx_execution_failed(
        court.connect(client_account)
        .claim_expiry(args=[aid])
        .transact(transaction_context=at(AFTER_DELIVERY + 60))
    )
    assert balance_of(client_account) <= before
    assert int(agreement(court, aid)["paid_out"]) == AMOUNT


def test_only_client_can_claim_expiry(court, client_account, provider_account, stranger_account):
    aid = funded_agreement(court, client_account, provider_account)
    for who in (provider_account, stranger_account):
        assert tx_execution_failed(
            court.connect(who)
            .claim_expiry(args=[aid])
            .transact(transaction_context=at(AFTER_DELIVERY))
        )
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT


def test_delivery_starts_a_finite_dispute_window(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    a = agreement(court, aid)
    assert int(a["dispute_deadline"]) == int(a["delivered_ts"]) + DISPUTE_WINDOW
    assert int(a["delivered_ts"]) > 0


def test_dispute_after_window_is_rejected(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account)
        .open_dispute(args=[aid, "too late"])
        .transact(transaction_context=at(AFTER_DISPUTE))
    )
    assert agreement(court, aid)["status"] == "DELIVERED"


def test_provider_releases_uncontested_delivery_after_window(
    court, client_account, provider_account
):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(  # window still open
        court.connect(provider_account).claim_uncontested(args=[aid]).transact()
    )

    before = balance_of(provider_account)
    assert tx_execution_succeeded(
        court.connect(provider_account)
        .claim_uncontested(args=[aid])
        .transact(transaction_context=at(AFTER_DISPUTE))
    )
    assert balance_of(provider_account) > before
    a = agreement(court, aid)
    assert a["status"] == "SETTLED"
    assert int(a["paid_out"]) == AMOUNT
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_uncontested_release_is_provider_only_and_single_shot(
    court, client_account, provider_account
):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account)
        .claim_uncontested(args=[aid])
        .transact(transaction_context=at(AFTER_DISPUTE))
    )
    court.connect(provider_account).claim_uncontested(args=[aid]).transact(
        transaction_context=at(AFTER_DISPUTE)
    )
    assert tx_execution_failed(
        court.connect(provider_account)
        .claim_uncontested(args=[aid])
        .transact(transaction_context=at(AFTER_DISPUTE + 60))
    )
    assert int(agreement(court, aid)["paid_out"]) == AMOUNT


def test_open_dispute_locks_escrow_against_every_expiry_path(
    court, client_account, provider_account
):
    aid = disputed_agreement(court, client_account, provider_account)
    late = at(AFTER_DISPUTE * 4)
    assert tx_execution_failed(
        court.connect(client_account).claim_expiry(args=[aid]).transact(transaction_context=late)
    )
    assert tx_execution_failed(
        court.connect(provider_account)
        .claim_uncontested(args=[aid])
        .transact(transaction_context=late)
    )
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT
    assert agreement(court, aid)["status"] == "DISPUTED"


def test_expiry_cannot_race_adjudicated_settlement(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(5, verdict("CLIENT", BPS)))
    )
    late = at(AFTER_DISPUTE * 4)
    assert tx_execution_failed(
        court.connect(client_account).claim_expiry(args=[aid]).transact(transaction_context=late)
    )

    court.settle(args=[aid]).transact()
    assert tx_execution_failed(
        court.connect(client_account).claim_expiry(args=[aid]).transact(transaction_context=late)
    )
    assert tx_execution_failed(
        court.connect(provider_account)
        .claim_uncontested(args=[aid])
        .transact(transaction_context=late)
    )
    assert int(agreement(court, aid)["paid_out"]) == AMOUNT
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_expired_agreement_cannot_enter_later_states(court, client_account, provider_account):
    aid = funded_agreement(court, client_account, provider_account)
    court.connect(client_account).claim_expiry(args=[aid]).transact(
        transaction_context=at(AFTER_DELIVERY)
    )
    late = at(AFTER_DELIVERY + 120)
    assert tx_execution_failed(
        court.connect(provider_account)
        .submit_deliverable(args=[aid, "", "late", ""])
        .transact(transaction_context=late)
    )
    assert tx_execution_failed(
        court.connect(client_account)
        .open_dispute(args=[aid, "changed my mind"])
        .transact(transaction_context=late)
    )
    assert tx_execution_failed(
        court.connect(client_account)
        .accept_deliverable(args=[aid])
        .transact(transaction_context=late)
    )
    assert tx_execution_failed(court.settle(args=[aid]).transact(transaction_context=late))


def test_balance_conservation_across_expiry_and_release(court, client_account, provider_account):
    aid1 = funded_agreement(court, client_account, provider_account, AMOUNT)
    aid2 = delivered_agreement(court, client_account, provider_account, AMOUNT * 2)
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT * 3

    court.connect(client_account).claim_expiry(args=[aid1]).transact(
        transaction_context=at(AFTER_DELIVERY)
    )
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT * 2

    provider_before = balance_of(provider_account)
    court.connect(provider_account).claim_uncontested(args=[aid2]).transact(
        transaction_context=at(AFTER_DISPUTE)
    )
    assert balance_of(provider_account) > provider_before
    assert int(court.get_escrow_balance(args=[]).call()) == 0
