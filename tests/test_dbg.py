from conftest import *
from gltest import get_contract_factory
from gltest.accounts import get_accounts
def test_dbg():
    a=get_accounts()
    f=get_contract_factory(contract_file_path=CONTRACT_PATH)
    c=f.deploy(args=[], account=a[1])
    c.connect(a[1]).create_agreement(args=[a[2].address, TERMS, CRITERIA, AMOUNT]).transact()
    aid=int(c.get_next_id(args=[]).call())-1
    r=c.connect(a[1]).fund_escrow(args=[aid]).transact(value=AMOUNT)
    import json
    print("STDERRS:", [x["genvm_result"]["stderr"] for x in r.get("consensus_data",{}).get("validators",[])][:1], r.get("consensus_data",{}).get("leader_receipt",{}))
