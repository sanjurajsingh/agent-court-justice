import json
from conftest import ctx, disputed_agreement, mocked_validators, verdict, BPS

def test_debug(court, client_account, provider_account):
    aid = disputed_agreement(court, client_account, provider_account)
    r = court.connect(client_account).adjudicate(args=[aid]).transact(
        transaction_context=ctx(mocked_validators(5, verdict("CLIENT", BPS)))
    )
    print(json.dumps(r.get("consensus_data", {}).get("leader_receipt", []), indent=1, default=str)[:3000])
