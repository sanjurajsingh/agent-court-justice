import type { Agreement, AgreementStatus } from "./genlayer/agentcourt";
import { weiToGen } from "./genlayer/config";

/**
 * The Intelligent Contract stores no separate title field, so the UI encodes
 * the title as the first line of the natural-language terms ("# Title").
 * That keeps the contract the single source of truth for everything the
 * validators read.
 */
export const TITLE_PREFIX = "# ";

export function encodeTerms(title: string, terms: string): string {
  const clean = title.trim();
  return clean ? `${TITLE_PREFIX}${clean}\n\n${terms.trim()}` : terms.trim();
}

export function agreementTitle(a: Agreement): string {
  const [first] = a.terms.split("\n");
  if (first && first.startsWith(TITLE_PREFIX)) return first.slice(TITLE_PREFIX.length).trim();
  return `Agreement #${a.id}`;
}

export function agreementBody(a: Agreement): string {
  const lines = a.terms.split("\n");
  if (lines[0]?.startsWith(TITLE_PREFIX)) return lines.slice(1).join("\n").trim();
  return a.terms;
}

export function shortAddress(addr: string, size = 4): string {
  if (!addr || addr.length < 2 * size + 4) return addr;
  return `${addr.slice(0, size + 2)}…${addr.slice(-size)}`;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function gen(wei: string | bigint | number, precision = 4): string {
  try {
    return weiToGen(BigInt(wei as never), precision);
  } catch {
    return "0.0000";
  }
}

export function isOpen(status: AgreementStatus): boolean {
  return status === "CREATED" || status === "FUNDED" || status === "DELIVERED";
}

export function isContested(status: AgreementStatus): boolean {
  return status === "DISPUTED" || status === "ADJUDICATED" || status === "APPEALED";
}

export function latestDecision(a: Agreement) {
  return a.decisions.length ? a.decisions[a.decisions.length - 1] : null;
}

export const STATUS_COPY: Record<AgreementStatus, string> = {
  CREATED: "Awaiting escrow funding",
  FUNDED: "Escrow held by the contract",
  DELIVERED: "Deliverable submitted, awaiting client",
  DISPUTED: "Dispute open — evidence phase",
  ADJUDICATED: "Verdict returned by GenLayer consensus",
  APPEALED: "Appeal filed — re-adjudication pending",
  SETTLED: "Escrow paid out on-chain",
  CANCELLED: "Cancelled before funding",
};
