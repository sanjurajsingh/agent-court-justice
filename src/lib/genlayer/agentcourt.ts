import { AGENTCOURT_ADDRESS } from "./config";
import { getReadClient, getWalletClient } from "./client";

export type AgreementStatus =
  | "CREATED"
  | "FUNDED"
  | "DELIVERED"
  | "DISPUTED"
  | "ADJUDICATED"
  | "APPEALED"
  | "SETTLED"
  | "CANCELLED";

export type Party = "CLIENT" | "PROVIDER" | "SPLIT";

export interface Decision {
  round: number;
  winner: Party;
  client_bps: number;
  provider_bps: number;
  client_award: string;
  provider_award: string;
  reason: string;
  evidence_validated: number;
  evidence_unavailable: number;
  evidence_content_verified: number;
  evidence_issuer_verified: number;
  decided_at: string;
}

export interface EvidenceItem {
  submitter: string;
  role: "CLIENT" | "PROVIDER";
  kind: "DELIVERABLE" | "EVIDENCE" | "APPEAL_GROUNDS";
  uri: string;
  statement: string;
  content_hash: string;
  source: "NONE" | "FETCHABLE" | "UNSUPPORTED";
  observed_hash: string;
  content_hash_verified: boolean;
  issuer_verified: boolean;
  issuer_identity: string;
  issuer_source: string;
  validation_status: "ASSERTION_ONLY" | "REFERENCED" | "CONTENT_VERIFIED" | "UNAVAILABLE" | "INVALID";
  submitted_at: string;
}

export interface Agreement {
  id: number;
  client: string;
  provider: string;
  terms: string;
  acceptance_criteria: string;
  amount: string;
  funded: string;
  bond_pool: string;
  status: AgreementStatus;
  created_at: string;
  dispute_reason: string;
  appeal_round: number;
  settled: boolean;
  paid_out: string;
  evidence_count: number;
  decisions: Decision[];
}

function contractAddress(): `0x${string}` {
  if (!AGENTCOURT_ADDRESS) {
    throw new Error("VITE_AGENTCOURT_ADDRESS is not set. Deploy contracts/agentcourt.py first.");
  }
  return AGENTCOURT_ADDRESS as `0x${string}`;
}

async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const client = getReadClient();
  return (await client.readContract({
    address: contractAddress(),
    functionName,
    args,
  } as never)) as T;
}

/**
 * Submits a state-changing call and returns the transaction hash as soon as
 * the wallet hands it over. Finality is reconciled separately by the pending
 * transaction store, so a slow or interrupted client never loses the hash.
 */
async function write(functionName: string, args: unknown[] = [], value = 0n): Promise<string> {
  const client = await getWalletClient();
  const hash = await client.writeContract({
    address: contractAddress(),
    functionName,
    args,
    value,
  } as never);
  return String(hash);
}

/* ------------------------------- reads -------------------------------- */

export const getAgreement = (id: number) => read<Agreement>("get_agreement", [id]);
export const getAgreementsFor = (address: string) =>
  read<Agreement[]>("get_agreements_for", [address]);
export const getDecisions = (id: number) => read<Decision[]>("get_decisions", [id]);
export const getEvidence = (id: number) => read<EvidenceItem[]>("get_evidence", [id]);
export const getEscrowBalance = () => read<string>("get_escrow_balance");
export const getLimits = () => read<Record<string, unknown>>("get_limits");

/* ------------------------------- writes ------------------------------- */

export const createAgreement = (p: {
  provider: string;
  terms: string;
  acceptanceCriteria: string;
  amountWei: bigint;
  deliveryWindow: number;
  disputeWindow: number;
}) =>
  // The live schema types `amount` as int, so the wei value is passed as a bigint.
  write("create_agreement", [
    p.provider,
    p.terms,
    p.acceptanceCriteria,
    p.amountWei,
    p.deliveryWindow,
    p.disputeWindow,
  ]);

export const fundEscrow = (id: number, amountWei: bigint) =>
  write("fund_escrow", [id], amountWei);

export const cancelAgreement = (id: number) => write("cancel_agreement", [id]);

export const submitDeliverable = (id: number, uri: string, note: string, contentHash = "") =>
  write("submit_deliverable", [id, uri, note, contentHash]);

export const submitEvidence = (id: number, uri: string, statement: string, contentHash = "") =>
  write("submit_evidence", [id, uri, statement, contentHash]);

export const acceptDeliverable = (id: number) => write("accept_deliverable", [id]);

export const openDispute = (id: number, reason: string) => write("open_dispute", [id, reason]);

/** Triggers GenLayer consensus adjudication. */
export const adjudicate = (id: number) => write("adjudicate", [id]);

export const appeal = (id: number, grounds: string, bondWei: bigint) =>
  write("appeal", [id, grounds], bondWei);

export const settle = (id: number) => write("settle", [id]);

/** Client recovers escrow after the delivery deadline passes with no delivery. */
export const claimExpiry = (id: number) => write("claim_expiry", [id]);

/** Provider is paid after the dispute window closes with no dispute. */
export const claimUncontested = (id: number) => write("claim_uncontested", [id]);

export const getNextId = () => read<string | number | bigint>("get_next_id");


export const APPEAL_BOND_BPS = 1000;
export const BPS = 10000;

/** Bond required to appeal: 10% of the escrowed amount. */
export function appealBondWei(amountWei: bigint): bigint {
  return (amountWei * BigInt(APPEAL_BOND_BPS)) / BigInt(BPS);
}

/**
 * The contract has no global enumeration view, so the full list is rebuilt by
 * reading ids 1..next_id-1 straight from the contract. No cache, no backend.
 */
export async function listAgreements(): Promise<Agreement[]> {
  const next = Number(await getNextId());
  const ids = Array.from({ length: Math.max(0, next - 1) }, (_, i) => i + 1);
  const results = await Promise.all(
    ids.map((id) => getAgreement(id).catch(() => null)),
  );
  return results.filter((a): a is Agreement => a !== null).reverse();
}
