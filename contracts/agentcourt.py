# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
AgentCourt — evidence-based dispute resolution and escrow for
human <-> human, human <-> AI agent and AI agent <-> AI agent agreements.

All consensus-critical logic (escrow accounting, adjudication, winner
selection and settlement) lives in this Intelligent Contract. Off-chain
services may only store files/metadata; they never decide outcomes.
"""

import json
import typing

from genlayer import *

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STATUS_CREATED = "CREATED"
STATUS_FUNDED = "FUNDED"
STATUS_DELIVERED = "DELIVERED"
STATUS_DISPUTED = "DISPUTED"
STATUS_ADJUDICATED = "ADJUDICATED"
STATUS_APPEALED = "APPEALED"
STATUS_SETTLED = "SETTLED"
STATUS_CANCELLED = "CANCELLED"

PARTY_CLIENT = "CLIENT"
PARTY_PROVIDER = "PROVIDER"
PARTY_SPLIT = "SPLIT"

BPS = 10000
MAX_APPEALS = 1
APPEAL_BOND_BPS = 1000  # 10% of escrow
AWARD_TOLERANCE_BPS = 500  # validator tolerance on the split


# ---------------------------------------------------------------------------
# Storage types
# ---------------------------------------------------------------------------


@allow_storage
@dataclass
class EvidenceItem:
    submitter: Address
    role: str  # CLIENT | PROVIDER
    kind: str  # DELIVERABLE | EVIDENCE
    uri: str  # off-chain pointer (Supabase storage, IPFS, http, ...)
    statement: str  # natural-language statement / hash note
    submitted_at: str


@allow_storage
@dataclass
class Decision:
    round: u32
    winner: str  # CLIENT | PROVIDER | SPLIT
    client_bps: u32
    provider_bps: u32
    client_award: u256
    provider_award: u256
    reason: str
    decided_at: str


@allow_storage
@dataclass
class Agreement:
    id: u256
    client: Address  # payer
    provider: Address  # performer (human or agent wallet)
    terms: str  # natural-language agreement terms
    acceptance_criteria: str  # natural-language acceptance criteria
    amount: u256  # required escrow (wei)
    funded: u256  # actually escrowed (wei)
    bond_pool: u256  # appeal bonds held (wei)
    status: str
    created_at: str
    dispute_reason: str
    appeal_round: u32
    appellant: Address
    settled: bool
    paid_out: u256
    evidence: DynArray[EvidenceItem]
    decisions: DynArray[Decision]


@gl.evm.contract_interface
class _Payee:
    class View:
        pass

    class Write:
        pass


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------


class AgentCourt(gl.Contract):
    agreements: TreeMap[u256, Agreement]
    by_party: TreeMap[Address, DynArray[u256]]
    next_id: u256

    def __init__(self):
        self.next_id = u256(1)

    # -- internal helpers ---------------------------------------------------

    def _get(self, agreement_id: u256) -> Agreement:
        a = self.agreements.get(agreement_id)
        if a is None:
            raise gl.vm.UserError("agreement not found")
        return a

    def _require_party(self, a: Agreement) -> str:
        sender = gl.message.sender_address
        if sender == a.client:
            return PARTY_CLIENT
        if sender == a.provider:
            return PARTY_PROVIDER
        raise gl.vm.UserError("unauthorized: caller is not a party")

    def _index(self, who: Address, agreement_id: u256) -> None:
        lst = self.by_party.get(who)
        if lst is None:
            self.by_party[who] = DynArray[u256]()
        self.by_party[who].append(agreement_id)

    def _now(self) -> str:
        return gl.message_raw["datetime"]

    def _pay(self, to: Address, amount: u256) -> None:
        if amount == u256(0):
            return
        if amount > self.balance:
            raise gl.vm.UserError("insufficient contract balance")
        _Payee(to).emit_transfer(value=amount)

    # -- lifecycle: creation & escrow --------------------------------------

    @gl.public.write
    def create_agreement(
        self,
        provider: str,
        terms: str,
        acceptance_criteria: str,
        amount: u256,
    ) -> u256:
        """Create an agreement. Caller becomes the client (payer)."""
        client = gl.message.sender_address
        provider_addr = Address(provider)
        if provider_addr == client:
            raise gl.vm.UserError("provider must differ from client")
        if amount == u256(0):
            raise gl.vm.UserError("amount must be > 0")
        if len(terms.strip()) == 0 or len(acceptance_criteria.strip()) == 0:
            raise gl.vm.UserError("terms and acceptance criteria are required")

        agreement_id = self.next_id
        self.next_id = agreement_id + u256(1)

        self.agreements[agreement_id] = Agreement(
            id=agreement_id,
            client=client,
            provider=provider_addr,
            terms=terms,
            acceptance_criteria=acceptance_criteria,
            amount=amount,
            funded=u256(0),
            bond_pool=u256(0),
            status=STATUS_CREATED,
            created_at=self._now(),
            dispute_reason="",
            appeal_round=u32(0),
            appellant=Address(bytes(20)),
            settled=False,
            paid_out=u256(0),
            evidence=DynArray[EvidenceItem](),
            decisions=DynArray[Decision](),
        )
        self._index(client, agreement_id)
        self._index(provider_addr, agreement_id)
        return agreement_id

    @gl.public.write.payable
    def fund_escrow(self, agreement_id: u256) -> None:
        """Client escrows native GEN. Exact amount, once."""
        a = self._get(agreement_id)
        if gl.message.sender_address != a.client:
            raise gl.vm.UserError("unauthorized: only the client funds escrow")
        if a.status != STATUS_CREATED:
            raise gl.vm.UserError("escrow already funded or agreement closed")
        v = gl.message.value
        if v != a.amount:
            raise gl.vm.UserError("must escrow exactly the agreed amount")
        a.funded = v
        a.status = STATUS_FUNDED

    @gl.public.write
    def cancel_agreement(self, agreement_id: u256) -> None:
        """Either party may cancel before funding; no value moves."""
        a = self._get(agreement_id)
        self._require_party(a)
        if a.status != STATUS_CREATED:
            raise gl.vm.UserError("only unfunded agreements can be cancelled")
        a.status = STATUS_CANCELLED

    # -- lifecycle: delivery & evidence ------------------------------------

    @gl.public.write
    def submit_deliverable(self, agreement_id: u256, uri: str, note: str) -> None:
        a = self._get(agreement_id)
        role = self._require_party(a)
        if role != PARTY_PROVIDER:
            raise gl.vm.UserError("unauthorized: only the provider delivers")
        if a.status not in (STATUS_FUNDED, STATUS_DELIVERED):
            raise gl.vm.UserError("escrow must be funded and dispute not open")
        a.evidence.append(
            EvidenceItem(
                submitter=gl.message.sender_address,
                role=PARTY_PROVIDER,
                kind="DELIVERABLE",
                uri=uri,
                statement=note,
                submitted_at=self._now(),
            )
        )
        a.status = STATUS_DELIVERED

    @gl.public.write
    def submit_evidence(self, agreement_id: u256, uri: str, statement: str) -> None:
        a = self._get(agreement_id)
        role = self._require_party(a)
        if a.status not in (
            STATUS_FUNDED,
            STATUS_DELIVERED,
            STATUS_DISPUTED,
            STATUS_APPEALED,
        ):
            raise gl.vm.UserError("evidence window is closed")
        if len(statement.strip()) == 0 and len(uri.strip()) == 0:
            raise gl.vm.UserError("evidence must contain a statement or a uri")
        a.evidence.append(
            EvidenceItem(
                submitter=gl.message.sender_address,
                role=role,
                kind="EVIDENCE",
                uri=uri,
                statement=statement,
                submitted_at=self._now(),
            )
        )

    @gl.public.write
    def accept_deliverable(self, agreement_id: u256) -> None:
        """Happy path: client accepts, full escrow released to provider."""
        a = self._get(agreement_id)
        if gl.message.sender_address != a.client:
            raise gl.vm.UserError("unauthorized: only the client accepts")
        if a.status not in (STATUS_FUNDED, STATUS_DELIVERED):
            raise gl.vm.UserError("nothing to accept")
        if a.settled:
            raise gl.vm.UserError("already settled")

        payout = a.funded + a.bond_pool
        a.decisions.append(
            Decision(
                round=u32(0),
                winner=PARTY_PROVIDER,
                client_bps=u32(0),
                provider_bps=u32(BPS),
                client_award=u256(0),
                provider_award=payout,
                reason="Client accepted the deliverable without dispute.",
                decided_at=self._now(),
            )
        )
        a.settled = True
        a.paid_out = payout
        a.status = STATUS_SETTLED
        self._pay(a.provider, payout)

    # -- dispute -----------------------------------------------------------

    @gl.public.write
    def open_dispute(self, agreement_id: u256, reason: str) -> None:
        a = self._get(agreement_id)
        self._require_party(a)
        if a.status not in (STATUS_FUNDED, STATUS_DELIVERED):
            raise gl.vm.UserError("dispute can only be opened on a live escrow")
        if a.settled:
            raise gl.vm.UserError("already settled")
        a.dispute_reason = reason
        a.status = STATUS_DISPUTED

    # -- adjudication (GenLayer consensus) ---------------------------------

    @gl.public.write
    def adjudicate(self, agreement_id: u256) -> typing.Any:
        """
        The core consensus step. Validators independently reason over the
        agreed natural-language terms + both parties' evidence and must agree
        on the winner (exact match) and on the award split (bps tolerance).
        """
        a = self._get(agreement_id)
        if a.status not in (STATUS_DISPUTED, STATUS_APPEALED):
            raise gl.vm.UserError("no open dispute to adjudicate")
        if a.settled:
            raise gl.vm.UserError("already settled")

        snapshot = gl.storage.copy_to_memory(a)
        case = _build_case(snapshot)
        appeal_round = int(snapshot.appeal_round)

        def leader_fn() -> dict:
            raw = gl.nondet.exec_prompt(_ADJUDICATION_PROMPT.format(case=case))
            return _parse_verdict(raw)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                mine = leader_fn()
                theirs = leader_result.calldata
            except Exception:
                return False
            if mine["winner"] != theirs["winner"]:
                return False
            return (
                abs(int(mine["client_bps"]) - int(theirs["client_bps"]))
                <= AWARD_TOLERANCE_BPS
            )

        verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        client_bps = int(verdict["client_bps"])
        provider_bps = BPS - client_bps
        pot = a.funded + a.bond_pool
        client_award = u256(int(pot) * client_bps // BPS)
        provider_award = pot - client_award

        a.decisions.append(
            Decision(
                round=u32(appeal_round),
                winner=str(verdict["winner"]),
                client_bps=u32(client_bps),
                provider_bps=u32(provider_bps),
                client_award=client_award,
                provider_award=provider_award,
                reason=str(verdict["reason"])[:2000],
                decided_at=self._now(),
            )
        )
        a.status = STATUS_ADJUDICATED
        return {
            "agreement_id": int(agreement_id),
            "winner": str(verdict["winner"]),
            "client_bps": client_bps,
            "provider_bps": provider_bps,
            "reason": str(verdict["reason"])[:2000],
        }

    # -- appeal ------------------------------------------------------------

    @gl.public.write.payable
    def appeal(self, agreement_id: u256, grounds: str) -> None:
        """
        A party may appeal one adjudication round by posting a bond
        (10% of escrow). The bond joins the pot and is redistributed by the
        final adjudication, so frivolous appeals are costly.
        """
        a = self._get(agreement_id)
        role = self._require_party(a)
        if a.status != STATUS_ADJUDICATED:
            raise gl.vm.UserError("nothing to appeal")
        if a.settled:
            raise gl.vm.UserError("already settled")
        if int(a.appeal_round) >= MAX_APPEALS:
            raise gl.vm.UserError("appeal limit reached")

        required = u256(int(a.amount) * APPEAL_BOND_BPS // BPS)
        if gl.message.value < required:
            raise gl.vm.UserError("insufficient appeal bond")

        a.bond_pool = a.bond_pool + gl.message.value
        a.appeal_round = u32(int(a.appeal_round) + 1)
        a.appellant = gl.message.sender_address
        a.status = STATUS_APPEALED
        a.evidence.append(
            EvidenceItem(
                submitter=gl.message.sender_address,
                role=role,
                kind="EVIDENCE",
                uri="",
                statement="APPEAL GROUNDS: " + grounds,
                submitted_at=self._now(),
            )
        )

    # -- settlement --------------------------------------------------------

    @gl.public.write
    def settle(self, agreement_id: u256) -> typing.Any:
        """Execute the last decision on-chain. Idempotency enforced."""
        a = self._get(agreement_id)
        if a.settled:
            raise gl.vm.UserError("already settled")
        if a.status != STATUS_ADJUDICATED:
            raise gl.vm.UserError("no final decision to settle")
        if len(a.decisions) == 0:
            raise gl.vm.UserError("no decision recorded")

        d = a.decisions[len(a.decisions) - 1]
        total = d.client_award + d.provider_award
        pot = a.funded + a.bond_pool
        if total > pot:
            raise gl.vm.UserError("award exceeds escrowed pot")
        if total > self.balance:
            raise gl.vm.UserError("insufficient contract balance")

        # mark settled BEFORE moving value (duplicate-settlement protection)
        a.settled = True
        a.paid_out = total
        a.status = STATUS_SETTLED

        self._pay(a.client, d.client_award)
        self._pay(a.provider, d.provider_award)
        return {
            "agreement_id": int(agreement_id),
            "client_award": int(d.client_award),
            "provider_award": int(d.provider_award),
            "winner": d.winner,
        }

    # -- views -------------------------------------------------------------

    @gl.public.view
    def get_agreement(self, agreement_id: u256) -> typing.Any:
        a = self._get(agreement_id)
        return _agreement_json(a)

    @gl.public.view
    def get_agreements_for(self, who: str) -> typing.Any:
        ids = self.by_party.get(Address(who))
        if ids is None:
            return []
        return [_agreement_json(self.agreements[i]) for i in ids]

    @gl.public.view
    def get_decisions(self, agreement_id: u256) -> typing.Any:
        a = self._get(agreement_id)
        return [_decision_json(d) for d in a.decisions]

    @gl.public.view
    def get_evidence(self, agreement_id: u256) -> typing.Any:
        a = self._get(agreement_id)
        return [_evidence_json(e) for e in a.evidence]

    @gl.public.view
    def get_escrow_balance(self) -> u256:
        return self.balance

    @gl.public.view
    def get_next_id(self) -> u256:
        return self.next_id


# ---------------------------------------------------------------------------
# Pure helpers (deterministic)
# ---------------------------------------------------------------------------

_ADJUDICATION_PROMPT = """You are an impartial arbitrator resolving a commercial dispute
between two parties (which may be humans or autonomous AI agents).

Decide strictly from the agreed terms, the acceptance criteria and the evidence
below. Do not invent facts. If evidence is missing or inconclusive for a claim,
weigh it against the party that carries the burden for that claim.

CASE FILE:
{case}

Return ONLY a JSON object, no prose, no markdown fences:
{{
  "winner": "CLIENT" | "PROVIDER" | "SPLIT",
  "client_bps": <integer 0-10000, share of the escrow returned to the CLIENT>,
  "reason": "<max 3 sentences citing the terms and evidence that decided it>"
}}
Rules: client_bps must be 0 when winner is PROVIDER, 10000 when winner is CLIENT,
and strictly between 0 and 10000 when winner is SPLIT. Round client_bps to the
nearest 500 so independent arbitrators converge."""


def _parse_verdict(raw: str) -> dict:
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    data = json.loads(cleaned)
    winner = str(data["winner"]).upper()
    if winner not in (PARTY_CLIENT, PARTY_PROVIDER, PARTY_SPLIT):
        raise gl.vm.UserError("invalid winner in verdict")
    client_bps = int(data["client_bps"])
    if client_bps < 0 or client_bps > BPS:
        raise gl.vm.UserError("invalid client_bps in verdict")
    if winner == PARTY_CLIENT:
        client_bps = BPS
    elif winner == PARTY_PROVIDER:
        client_bps = 0
    else:
        client_bps = max(500, min(BPS - 500, round(client_bps / 500) * 500))
    return {
        "winner": winner,
        "client_bps": client_bps,
        "reason": str(data.get("reason", ""))[:2000],
    }


def _build_case(a) -> str:
    lines = [
        f"Agreement #{int(a.id)} (created {a.created_at})",
        f"CLIENT (payer): {a.client}",
        f"PROVIDER (performer): {a.provider}",
        f"Escrowed amount (wei): {int(a.funded)}",
        f"Appeal round: {int(a.appeal_round)}",
        "",
        "AGREED TERMS:",
        a.terms,
        "",
        "ACCEPTANCE CRITERIA:",
        a.acceptance_criteria,
        "",
        f"DISPUTE REASON: {a.dispute_reason}",
        "",
        "SUBMISSIONS:",
    ]
    for e in a.evidence:
        lines.append(f"- [{e.role}/{e.kind} @ {e.submitted_at}] {e.statement} (ref: {e.uri})")
    if len(a.decisions) > 0:
        lines.append("")
        lines.append("PRIOR DECISIONS UNDER APPEAL:")
        for d in a.decisions:
            lines.append(
                f"- round {int(d.round)}: winner={d.winner}, client_bps={int(d.client_bps)} — {d.reason}"
            )
    return "\n".join(lines)


def _evidence_json(e) -> dict:
    return {
        "submitter": str(e.submitter),
        "role": e.role,
        "kind": e.kind,
        "uri": e.uri,
        "statement": e.statement,
        "submitted_at": e.submitted_at,
    }


def _decision_json(d) -> dict:
    return {
        "round": int(d.round),
        "winner": d.winner,
        "client_bps": int(d.client_bps),
        "provider_bps": int(d.provider_bps),
        "client_award": str(int(d.client_award)),
        "provider_award": str(int(d.provider_award)),
        "reason": d.reason,
        "decided_at": d.decided_at,
    }


def _agreement_json(a) -> dict:
    return {
        "id": int(a.id),
        "client": str(a.client),
        "provider": str(a.provider),
        "terms": a.terms,
        "acceptance_criteria": a.acceptance_criteria,
        "amount": str(int(a.amount)),
        "funded": str(int(a.funded)),
        "bond_pool": str(int(a.bond_pool)),
        "status": a.status,
        "created_at": a.created_at,
        "dispute_reason": a.dispute_reason,
        "appeal_round": int(a.appeal_round),
        "settled": a.settled,
        "paid_out": str(int(a.paid_out)),
        "evidence_count": len(a.evidence),
        "decisions": [_decision_json(d) for d in a.decisions],
    }
