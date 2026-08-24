from conftest import *
from gltest import get_contract_factory
from gltest.accounts import get_accounts
def test_dbg():
    accts=get_accounts()
    f=get_contract_factory(contract_file_path=CONTRACT_PATH)
    c=f.deploy(args=[], account=accts[1])
    r=c.connect(accts[1]).create_agreement(args=[accts[2].address, TERMS, CRITERIA, str(AMOUNT)]).transact()
    import json; print(json.dumps(r, indent=1, default=str)[:3000])
