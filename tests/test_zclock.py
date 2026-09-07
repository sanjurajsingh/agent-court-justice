from conftest import agreement, at, new_agreement


def test_clock_warp(court, client_account, provider_account):
    aid = new_agreement(court, client_account, provider_account)
    a = agreement(court, aid)
    print("NOW:", a["created_at"], a["created_ts"])
    court.connect(client_account).create_agreement(
        args=[provider_account.address, "t", "c", 10**17, 86400, 86400]
    ).transact(transaction_context=at(999999))
    b = agreement(court, aid + 1)
    print("WARPED:", b["created_at"], b["created_ts"])
    assert int(b["created_ts"]) > int(a["created_ts"]) + 900000
