"""
Patch the locally installed GLSim (genlayer-test[sim]) so the AgentCourt suite
can run without Docker.

GLSim 0.29.2 has three gaps that block a money-handling contract:

1. contract-class cache stores the *proxy* class returned by
   ``_allocate_contract`` instead of the real contract class, so the second and
   any later deployment of the same file fails with
   "class is not marked for usage within storage".
2. native token value is decoded from the raw transaction but never plumbed
   into ``gl.message.value`` nor into account balances.
3. ``PostMessage`` (which is what ``emit_transfer`` produces) ignores the
   ``value`` field, so contract -> EOA payouts never move funds.

This script is idempotent: run it after every ``pip install genlayer-test[sim]``.

Usage:  python tools/glsim_patch.py /path/to/site-packages/glsim
"""

import sys
from pathlib import Path

MARKER = "# --- agentcourt glsim patch ---"


def patch_state(pkg: Path) -> None:
    p = pkg / "state.py"
    s = p.read_text()
    if MARKER in s:
        return
    old = """    def get_or_create_account(self, address: str) -> Account:
        addr = address.lower()
        if addr not in self.accounts:
            self.accounts[addr] = Account(address=addr)
        return self.accounts[addr]"""
    new = """    DEFAULT_SEED_BALANCE = 10**24

    def get_or_create_account(self, address: str) -> Account:
        %s
        addr = address.lower()
        if addr not in self.accounts:
            seed = 0 if addr in self.contracts else self.DEFAULT_SEED_BALANCE
            self.accounts[addr] = Account(address=addr, balance=seed)
        return self.accounts[addr]""" % MARKER
    assert old in s, "state.py: unexpected source"
    p.write_text(s.replace(old, new))


def patch_engine(pkg: Path) -> None:
    p = pkg / "engine.py"
    s = p.read_text()
    if MARKER in s:
        return

    # 1. cache the real contract class, not the calldata proxy
    old = """        # Extract and cache the contract class
        contract_cls = type(instance)
        for cls in type(instance).__mro__:"""
    new = """        # Extract and cache the contract class
        %s
        try:
            _real = object.__getattribute__(instance, '_instance')
        except AttributeError:
            _real = instance
        contract_cls = type(_real)
        for cls in type(_real).__mro__:""" % MARKER
    assert old in s
    s = s.replace(old, new)

    # 2. balance helpers + value-aware call_method
    old = """    def call_method(
        self,
        contract_address: str,
        method_name: str,
        args: list | None = None,
        kwargs: dict | None = None,
        sender: Optional[str] = None,
    ) -> Any:"""
    new = """    def _sync_vm_balances(self) -> None:
        \"\"\"Mirror state-store balances into the VM (wasi get_balance).\"\"\"
        try:
            bal = {}
            for addr, acct in self.state.accounts.items():
                bal[bytes.fromhex(addr[2:])] = acct.balance
            self.vm._balances = bal
        except Exception:
            pass

    def _move_value(self, frm: str, to: str, amount: int) -> None:
        if amount <= 0:
            return
        src = self.state.get_or_create_account(frm)
        dst = self.state.get_or_create_account(to)
        if src.balance < amount:
            raise ValueError('insufficient balance for value transfer')
        src.balance -= amount
        dst.balance += amount
        self._sync_vm_balances()

    def call_method(
        self,
        contract_address: str,
        method_name: str,
        args: list | None = None,
        kwargs: dict | None = None,
        sender: Optional[str] = None,
        value: int = 0,
    ) -> Any:"""
    assert old in s
    s = s.replace(old, new)

    old = """        self._set_message_context(
            contract_address=addr_bytes,
            sender=self.vm.sender,
        )
        self._sync_gl_message_contract_address(addr_bytes)

        method = getattr(instance, method_name, None)"""
    new = """        self._set_message_context(
            contract_address=addr_bytes,
            sender=self.vm.sender,
            value=value,
        )
        self._sync_gl_message_contract_address(addr_bytes)

        sender_key = ("0x" + self.vm.sender.hex()) if isinstance(self.vm.sender, bytes) else str(sender or "").lower()
        if value:
            self._move_value(sender_key, addr, value)
        else:
            self._sync_vm_balances()

        method = getattr(instance, method_name, None)"""
    assert old in s
    s = s.replace(old, new)

    old = """        self._call_depth += 1
        try:
            result = method(*args, **kwargs)
        finally:
            self._call_depth -= 1"""
    new = """        self._call_depth += 1
        try:
            result = method(*args, **kwargs)
        except Exception:
            if value:
                self._move_value(addr, sender_key, value)
            raise
        finally:
            self._call_depth -= 1
            self._set_message_context(
                contract_address=addr_bytes,
                sender=self.vm.sender,
                value=0,
            )"""
    assert old in s
    s = s.replace(old, new)

    s = s.replace(
        "    def _set_message_context(contract_address: Any, sender: Any) -> None:",
        "    def _set_message_context(contract_address: Any, sender: Any, value: int = 0) -> None:",
    )
    old = """            gl = sys.modules['genlayer.gl']
            from genlayer.py.types import Address

            if isinstance(contract_address, bytes):
                contract_address = Address(contract_address)
            if isinstance(sender, bytes):
                sender = Address(sender)

            if hasattr(gl, 'message') and gl.message is not None:
                gl.message = gl.MessageType(
                    contract_address=contract_address,
                    sender_address=sender,
                    origin_address=gl.message.origin_address,
                    value=gl.message.value,
                    chain_id=gl.message.chain_id,
                )
        except (ImportError, AttributeError):
            pass"""
    new = """            gl = sys.modules['genlayer.gl']
            from genlayer.py.types import Address, u256

            if isinstance(contract_address, bytes):
                contract_address = Address(contract_address)
            if isinstance(sender, bytes):
                sender = Address(sender)

            if hasattr(gl, 'message') and gl.message is not None:
                gl.message = gl.MessageType(
                    contract_address=contract_address,
                    sender_address=sender,
                    origin_address=gl.message.origin_address,
                    value=u256(value),
                    chain_id=gl.message.chain_id,
                )
        except (ImportError, AttributeError):
            pass"""
    assert s.count(old) == 1
    s = s.replace(old, new)

    # 3. PostMessage / emit_transfer moves native value
    old = """        print(f"[PostMessage] enqueueing {method_name} to {address}")"""
    new = """        print(f"[PostMessage] enqueueing {method_name} to {address}")

        _val = int(data.get('value') or 0)"""
    assert old in s
    s = s.replace(old, new)

    old = """        if method_name and self._instances.get(addr_key) is not None:"""
    new = """        if _val:
            frm = vm._contract_address
            frm_key = "0x" + frm.hex() if isinstance(frm, bytes) else str(frm).lower()
            self._move_value(frm_key, addr_key, _val)
            self._captured_triggered_ops.append({
                "type": "transfer",
                "address": addr_key,
                "value": _val,
            })

        if method_name and self._instances.get(addr_key) is not None:"""
    assert old in s
    s = s.replace(old, new)

    # value passthrough for raw-calldata calls
    old = """        contract_address: str,
        calldata_bytes: bytes,
        sender: Optional[str] = None,
    ) -> Tuple[Any, bytes]:"""
    new = """        contract_address: str,
        calldata_bytes: bytes,
        sender: Optional[str] = None,
        value: int = 0,
    ) -> Tuple[Any, bytes]:"""
    assert old in s
    s = s.replace(old, new)
    old = """        result = self.call_method(contract_address, method, args, kwargs, sender)
        result_bytes = encode_calldata_result(result)"""
    new = """        result = self.call_method(contract_address, method, args, kwargs, sender, value=value)
        result_bytes = encode_calldata_result(result)"""
    assert old in s
    s = s.replace(old, new)

    p.write_text(s)


def patch_server(pkg: Path) -> None:
    p = pkg / "server.py"
    s = p.read_text()
    if "value=eth_tx.get" in s:
        return
    old = """            result, _ = engine.call_from_calldata(recipient, calldata_bytes, sender)"""
    new = """            result, _ = engine.call_from_calldata(recipient, calldata_bytes, sender, value=eth_tx.get("value", 0))"""
    assert old in s
    s = s.replace(old, new)

    # 4. keep per-validator LLM mocks so the Equivalence Principle can be
    #    exercised with validators that answer differently. Upstream only
    #    installs validators[0]'s mocks and applies them to everyone.
    old = """    # LLM mocks
    llm_mocks = pc.get("mock_response", {}).get("response", {})
    for prompt_key, response_text in llm_mocks.items():
        engine.vm.mock_llm(prompt_key, response_text)"""
    new = """    # LLM mocks
    llm_mocks = pc.get("mock_response", {}).get("response", {})
    for prompt_key, response_text in llm_mocks.items():
        engine.vm.mock_llm(prompt_key, response_text)
    per_validator = []
    for v in validators:
        vpc = v.get("plugin_config", {}) or {}
        vmocks = (vpc.get("mock_response", {}) or {}).get("response", {}) or {}
        per_validator.append(
            [(re.compile(k), r) for k, r in vmocks.items()]
        )
    engine.vm._per_validator_llm_mocks = per_validator"""
    assert old in s
    s = s.replace(old, new)

    old = """    engine.vm._llm_mocks.clear()
    engine.vm._llm_mocks_hit.clear()"""
    new = """    engine.vm._llm_mocks.clear()
    engine.vm._llm_mocks_hit.clear()
    engine.vm._per_validator_llm_mocks = []"""
    assert old in s
    s = s.replace(old, new)
    p.write_text(s)


def patch_consensus(pkg: Path) -> None:
    p = pkg / "consensus.py"
    s = p.read_text()
    if MARKER in s:
        return
    old = """    votes = []
    for _ in range(num_validators):
        all_agree = True"""
    new = """    %s
    # Each validator re-runs the nondet block against *its own* mocked LLM
    # answer when the test provided one, so disagreement can be simulated.
    per_validator = getattr(vm, "_per_validator_llm_mocks", None) or []
    original_mocks = list(vm._llm_mocks)

    votes = []
    for _idx in range(num_validators):
        if _idx < len(per_validator) and per_validator[_idx]:
            vm._llm_mocks = list(per_validator[_idx])
        else:
            vm._llm_mocks = list(original_mocks)
        all_agree = True""" % MARKER
    assert old in s
    s = s.replace(old, new)
    old = """        votes.append("agree" if all_agree else "disagree")
    return votes"""
    new = """        votes.append("agree" if all_agree else "disagree")
    vm._llm_mocks = original_mocks
    return votes"""
    assert old in s
    s = s.replace(old, new)
    p.write_text(s)


def main() -> None:
    pkg = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if pkg is None:
        import glsim  # type: ignore

        pkg = Path(glsim.__file__).parent
    patch_state(pkg)
    patch_engine(pkg)
    patch_server(pkg)
    patch_consensus(pkg)
    print(f"glsim patched at {pkg}")


if __name__ == "__main__":
    main()
