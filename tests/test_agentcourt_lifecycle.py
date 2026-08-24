"""Creation, escrow funding, delivery, evidence and the happy path."""

from gltest.assertions import tx_execution_succeeded, tx_execution_failed

from conftest import (
    AMOUNT,
    CRITERIA,
    TERMS,
    agreement,
    balance_of,
    delivered_agreement,
    funded_agreement,
    new_agreement,
)


def test_create_agreement(court, client_account, provider_account):
    receipt = court.connect(client_account).create_agreement(
        args=[provider_account.address, TERMS, CRITERIA, AMOUNT]
    ).transact()
    assert tx_execution_succeeded(receipt)

    aid = int(court.get_next_id(args=[]).call()) - 1
    a = agreement(court, aid)
    assert a["status"] == "CREATED"
    assert a["client"].lower() == client_account.address.lower()
    assert a["provider"].lower() == provider_account.address.lower()
    assert int(a["amount"]) == AMOUNT
    assert int(a["funded"]) == 0
    assert a["settled"] is False
    assert a["terms"] == TERMS


def test_create_agreement_rejects_self_dealing_and_zero_amount(court, client_account):
    assert tx_execution_failed(
        court.connect(client_account)
        .create_agreement(args=[client_account.address, TERMS, CRITERIA, AMOUNT])
        .transact()
    )


def test_create_agreement_rejects_zero_amount(court, client_account, provider_account):
    assert tx_execution_failed(
        court.connect(client_account)
        .create_agreement(args=[provider_account.address, TERMS, CRITERIA, "0"])
        .transact()
    )


def test_agreement_indexed_for_both_parties(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    for who in (client_account, provider_account):
        ids = [int(x["id"]) for x in court.get_agreements_for(args=[who.address]).call()]
        assert aid in ids


def test_fund_escrow_exact_amount_moves_native_gen(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    before_contract = int(court.get_escrow_balance(args=[]).call())
    before_client = balance_of(client_account)

    receipt = court.connect(client_account).fund_escrow(args=[aid]).transact(value=AMOUNT)
    assert tx_execution_succeeded(receipt)

    a = agreement(court, aid)
    assert a["status"] == "FUNDED"
    assert int(a["funded"]) == AMOUNT
    assert int(court.get_escrow_balance(args=[]).call()) == before_contract + AMOUNT
    assert balance_of(client_account) <= before_client - AMOUNT


def test_fund_escrow_rejects_wrong_amount(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account).fund_escrow(args=[aid]).transact(value=AMOUNT - 1)
    )
    assert tx_execution_failed(
        court.connect(client_account).fund_escrow(args=[aid]).transact(value=AMOUNT * 2)
    )
    assert agreement(court, aid)["status"] == "CREATED"
    assert int(court.get_escrow_balance(args=[]).call()) == 0


def test_fund_escrow_rejects_unauthorized_funder(
    court, client_account, provider_account, stranger_account
):
    aid = new_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(stranger_account).fund_escrow(args=[aid]).transact(value=AMOUNT)
    )
    assert tx_execution_failed(
        court.connect(provider_account).fund_escrow(args=[aid]).transact(value=AMOUNT)
    )
    assert agreement(court, aid)["status"] == "CREATED"


def test_fund_escrow_rejects_double_funding(court, client_account, provider_account):
    aid = funded_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account).fund_escrow(args=[aid]).transact(value=AMOUNT)
    )
    assert int(court.get_escrow_balance(args=[]).call()) == AMOUNT


def test_cancel_before_funding_only(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    assert tx_execution_succeeded(
        court.connect(provider_account).cancel_agreement(args=[aid]).transact()
    )
    assert agreement(court, aid)["status"] == "CANCELLED"

    aid2 = funded_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account).cancel_agreement(args=[aid2]).transact()
    )


def test_submit_deliverable_by_provider(court, client_account, provider_account):
    aid = funded_agreement(court, client_account, provider_account)
    receipt = court.connect(provider_account).submit_deliverable(
        args=[aid, "ipfs://cid-1", "Delivered all 3 endpoints."]
    ).transact()
    assert tx_execution_succeeded(receipt)

    assert agreement(court, aid)["status"] == "DELIVERED"
    evidence = court.get_evidence(args=[aid]).call()
    assert len(evidence) == 1
    assert evidence[0]["kind"] == "DELIVERABLE"
    assert evidence[0]["role"] == "PROVIDER"
    assert evidence[0]["uri"] == "ipfs://cid-1"


def test_submit_deliverable_rejects_unauthorized(
    court, client_account, provider_account, stranger_account
):
    aid = funded_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(client_account).submit_deliverable(args=[aid, "u", "n"]).transact()
    )
    assert tx_execution_failed(
        court.connect(stranger_account).submit_deliverable(args=[aid, "u", "n"]).transact()
    )
    assert len(court.get_evidence(args=[aid]).call()) == 0


def test_submit_deliverable_requires_funded_escrow(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(provider_account).submit_deliverable(args=[aid, "u", "n"]).transact()
    )


def test_submit_evidence_from_both_parties(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_succeeded(
        court.connect(client_account)
        .submit_evidence(args=[aid, "ipfs://client-log", "Endpoint 3 returns 500."])
        .transact()
    )
    assert tx_execution_succeeded(
        court.connect(provider_account)
        .submit_evidence(args=[aid, "ipfs://provider-log", "Endpoint 3 passes in CI."])
        .transact()
    )
    evidence = court.get_evidence(args=[aid]).call()
    roles = [e["role"] for e in evidence]
    assert roles.count("CLIENT") == 1
    assert roles.count("PROVIDER") == 2  # deliverable + evidence


def test_submit_evidence_rejects_unauthorized_and_empty(
    court, client_account, provider_account, stranger_account
):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(stranger_account).submit_evidence(args=[aid, "u", "s"]).transact()
    )
    assert tx_execution_failed(
        court.connect(client_account).submit_evidence(args=[aid, "  ", "  "]).transact()
    )
    assert len(court.get_evidence(args=[aid]).call()) == 1


def test_accept_deliverable_happy_path_pays_provider(court, client_account, provider_account):
    aid = delivered_agreement(court, client_account, provider_account)
    provider_before = balance_of(provider_account)

    receipt = court.connect(client_account).accept_deliverable(args=[aid]).transact()
    assert tx_execution_succeeded(receipt)

    a = agreement(court, aid)
    assert a["status"] == "SETTLED"
    assert a["settled"] is True
    assert int(a["paid_out"]) == AMOUNT
    assert a["decisions"][-1]["winner"] == "PROVIDER"
    assert int(a["decisions"][-1]["provider_award"]) == AMOUNT

    # real native GEN moved out of the contract into the provider wallet
    assert int(court.get_escrow_balance(args=[]).call()) == 0
    assert balance_of(provider_account) == provider_before + AMOUNT


def test_accept_deliverable_rejects_non_client_and_double_accept(
    court, client_account, provider_account, stranger_account
):
    aid = delivered_agreement(court, client_account, provider_account)
    assert tx_execution_failed(
        court.connect(provider_account).accept_deliverable(args=[aid]).transact()
    )
    assert tx_execution_failed(
        court.connect(stranger_account).accept_deliverable(args=[aid]).transact()
    )
    assert tx_execution_succeeded(
        court.connect(client_account).accept_deliverable(args=[aid]).transact()
    )
    assert tx_execution_failed(
        court.connect(client_account).accept_deliverable(args=[aid]).transact()
    )
