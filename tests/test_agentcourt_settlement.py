"""Settlement: real native GEN transfers, idempotency and pot invariants."""

from gltest.assertions import tx_execution_succeeded, tx_execution_failed

from conftest import (
    AMOUNT,
    BPS,
    agreement,
    balance_of,
    ctx,
    delivered_agreement,
    disputed_agreement,
    mocked_validators,
    verdict,
)


def adjudicate_with(court, caller, aid, winner, bps, n=5):
    return court.connect(caller).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(n, verdict(winner, bps)))
    )


def test_settle_full_client_win_transfers_native_gen(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)

    client_before = balance_of(client_account)
    provider_before = balance_of(provider_account)

    # settled by the provider so the client balance is not distorted by gas
    assert tx_execution_succeeded(
        court.connect(provider_account).settle(args=[aid]).transact()
    )

    assert balance_of(client_account) == client_before + AMOUNT
    assert balance_of(provider_account) <= provider_before  # only gas spent
    assert int(court.get_escrow_balance(args=[]).call()) == 0

    a = agreement(court, aid)
    assert a["status"] == "SETTLED"
    assert a["settled"] is True
    assert int(a["paid_out"]) == AMOUNT


def test_settle_full_provider_win_transfers_native_gen(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, provider_account, aid, "PROVIDER", 0)

    provider_before = balance_of(provider_account)
    assert tx_execution_succeeded(court.connect(client_account).settle(args=[aid]).transact())

    assert balance_of(provider_account) == provider_before + AMOUNT
    assert int(court.get_escrow_balance(args=[]).call()) == 0
    assert int(agreement(court, aid)["paid_out"]) == AMOUNT


def test_settle_partial_split_transfers_both_sides(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "SPLIT", 3500)

    d = agreement(court, aid)["decisions"][-1]
    client_award = int(d["client_award"])
    provider_award = int(d["provider_award"])
    assert client_award == AMOUNT * 3500 // BPS
    assert client_award + provider_award == AMOUNT

    client_before = balance_of(client_account)
    provider_before = balance_of(provider_account)

    # settled by a third party so neither payee's delta is polluted by gas
    assert tx_execution_succeeded(court.settle(args=[aid]).transact())

    assert balance_of(client_account) == client_before + client_award
    assert balance_of(provider_account) == provider_before + provider_award
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_settlement_never_exceeds_the_pot(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "SPLIT", 5000)

    a = agreement(court, aid)
    pot = int(a["funded"]) + int(a["bond_pool"])
    d = a["decisions"][-1]
    assert int(d["client_award"]) + int(d["provider_award"]) == pot
    assert pot <= int(court.get_escrow_balance(args=[]).call())

    court.settle(args=[aid]).transact()
    assert int(agreement(court, aid)["paid_out"]) <= pot


def test_settle_before_adjudication_is_rejected(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    assert tx_execution_failed(court.connect(client_account).settle(args=[aid]).transact())
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT
    assert agreement(court, aid)["settled"] is False


def test_settle_on_merely_delivered_agreement_is_rejected(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(court.connect(client_account).settle(args=[aid]).transact())
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT


def test_duplicate_settlement_is_rejected(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "PROVIDER", 0)
    assert tx_execution_succeeded(court.settle(args=[aid]).transact())

    provider_before = balance_of(provider_account)
    assert tx_execution_failed(court.settle(args=[aid]).transact())
    assert balance_of(provider_account) == provider_before
    assert int(agreement(court, aid)["paid_out"]) == AMOUNT


def test_settled_agreement_is_frozen(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    adjudicate_with(court, client_account, aid, "CLIENT", BPS)
    court.settle(args=[aid]).transact()

    assert tx_execution_failed(
        court.connect(client_account).accept_deliverable(args=[aid]).transact()
    )
    assert tx_execution_failed(
        court.connect(client_account).open_dispute(args=[aid, "again"]).transact()
    )
    assert tx_execution_failed(
        court.connect(provider_account).submit_deliverable(args=[aid, "u", "n"]).transact()
    )


def test_contract_cannot_overpay_across_concurrent_agreements(
    court, client_account, provider_account
):
    """Two live escrows: settling one must never touch the other's funds."""
    aid1 = disputed_agreement(court, client_account, provider_account, AMOUNT)
    aid2 = disputed_agreement(court, client_account, provider_account, AMOUNT * 2)
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT * 3

    adjudicate_with(court, client_account, aid1, "CLIENT", BPS)
    court.settle(args=[aid1]).transact()

    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT * 2
    assert agreement(court, aid2)["status"] == "DISPUTED"
    assert int(agreement(court, aid2)["funded"]) == AMOUNT * 2

    adjudicate_with(court, client_account, aid2, "PROVIDER", 0)
    provider_before = balance_of(provider_account)
    court.settle(args=[aid2]).transact()
    assert balance_of(provider_account) == provider_before + AMOUNT * 2
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_unknown_agreement_reads_and_writes_fail(court, client_account):
    assert tx_execution_failed(court.connect(client_account).settle(args=[9999]).transact())
