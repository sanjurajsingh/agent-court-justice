import { AGENTCOURT_ADDRESS, NETWORK } from "./config";
import { getReadClient } from "./client";

/**
 * Durable registry of submitted GenLayer writes.
 *
 * A transaction hash is recorded the instant the wallet returns it, before any
 * finality is known. Entries are scoped to the wallet that signed them, survive
 * a page reload, and are only removed once the network reports a terminal
 * status. ACCEPTED is a pending status, never a result.
 */

export type TxPhase = "idle" | "confirming" | "pending" | "success" | "error";

export interface PendingTx {
  /** Stable identity: one in-flight write per account + label + scope. */
  id: string;
  account: string;
  label: string;
  scope: string;
  hash: string;
  contract: string;
  network: string;
  submittedAt: number;
  lastStatus: string;
  /** Last reconciliation problem, informational only, never terminal. */
  lastPollError?: string | undefined;
}

export interface TerminalResult {
  entry: PendingTx;
  ok: boolean;
  status: string;
  error?: string;
}

const STORAGE_KEY = "agentcourt.pending-tx.v1";
const POLL_INTERVAL_MS = 4000;

/** Statuses that are still in flight. ACCEPTED is explicitly pending. */
const PENDING_STATUSES = new Set([
  "PENDING",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "ACCEPTED",
  "ACTIVATED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
  "UNDETERMINED",
  "APPEAL_REVEALING",
  "APPEAL_COMMITTING",
]);

/** Terminal success. */
const SUCCESS_STATUSES = new Set(["FINALIZED"]);

/** Terminal failure. */
const FAILURE_STATUSES = new Set(["CANCELED", "CANCELLED", "REVERTED", "FAILED", "ERROR"]);

export function txKey(account: string, label: string, scope: string) {
  return `${account.toLowerCase()}::${label}::${scope}`;
}

/* --------------------------- persistence ---------------------------- */

let cache: PendingTx[] | null = null;
const listeners = new Set<() => void>();
const terminalListeners = new Set<(r: TerminalResult) => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function load(): PendingTx[] {
  if (cache) return cache;
  const s = storage();
  if (!s) return (cache = []);
  try {
    const raw = s.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingTx[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter((e) => e && e.hash && e.account) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(next: PendingTx[]) {
  cache = next;
  const s = storage();
  try {
    s?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode, in-memory state still holds */
  }
  listeners.forEach((l) => l());
}

export function listPending(account?: string | null): PendingTx[] {
  const all = load();
  if (!account) return all;
  return all.filter((e) => e.account.toLowerCase() === account.toLowerCase());
}

export function findPending(account: string, label: string, scope: string): PendingTx | null {
  const key = txKey(account, label, scope);
  return load().find((e) => e.id === key) ?? null;
}

export function findPendingByScope(account: string, scope: string): PendingTx | null {
  const acc = account.toLowerCase();
  return (
    load().find((e) => e.account.toLowerCase() === acc && e.scope === scope) ?? null
  );
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function onTerminal(listener: (r: TerminalResult) => void) {
  terminalListeners.add(listener);
  return () => {
    terminalListeners.delete(listener);
  };
}

export function recordPending(input: {
  account: string;
  label: string;
  scope: string;
  hash: string;
}): PendingTx {
  const entry: PendingTx = {
    id: txKey(input.account, input.label, input.scope),
    account: input.account,
    label: input.label,
    scope: input.scope,
    hash: input.hash,
    contract: AGENTCOURT_ADDRESS,
    network: NETWORK,
    submittedAt: Date.now(),
    lastStatus: "SUBMITTED",
  };
  persist([...load().filter((e) => e.id !== entry.id), entry]);
  startReconciler();
  return entry;
}

function update(id: string, patch: Partial<PendingTx>) {
  persist(load().map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

function remove(id: string) {
  persist(load().filter((e) => e.id !== id));
}

/* --------------------------- reconciliation -------------------------- */

function statusOf(tx: unknown): string {
  const t = tx as { status?: unknown; statusName?: unknown } | null;
  const raw = t?.status ?? t?.statusName;
  return typeof raw === "string" ? raw.toUpperCase() : String(raw ?? "UNKNOWN").toUpperCase();
}

function failureMessage(tx: unknown): string | undefined {
  const t = tx as { consensus_data?: { leader_receipt?: unknown } } | null;
  const receipt = t?.consensus_data?.leader_receipt as
    | { execution_result?: string; result?: unknown }
    | Array<{ execution_result?: string }>
    | undefined;
  const first = Array.isArray(receipt) ? receipt[0] : receipt;
  if (first?.execution_result && first.execution_result !== "SUCCESS") {
    return `Execution result: ${first.execution_result}`;
  }
  return undefined;
}

async function reconcileOne(entry: PendingTx) {
  let tx: unknown;
  try {
    tx = await getReadClient().getTransaction({ hash: entry.hash as `0x${string}` } as never);
  } catch (e) {
    // A read failure or client timeout is NOT a transaction failure. The hash
    // is known, so the write stays pending and is retried on the next tick.
    update(entry.id, { lastPollError: e instanceof Error ? e.message : String(e) });
    return;
  }

  const status = statusOf(tx);
  if (status !== entry.lastStatus) update(entry.id, { lastStatus: status, lastPollError: undefined });

  if (SUCCESS_STATUSES.has(status)) {
    const failure = failureMessage(tx);
    remove(entry.id);
    emitTerminal({
      entry: { ...entry, lastStatus: status },
      ok: !failure,
      status,
      ...(failure ? { error: failure } : {}),
    });
    return;
  }

  if (FAILURE_STATUSES.has(status)) {
    remove(entry.id);
    emitTerminal({
      entry: { ...entry, lastStatus: status },
      ok: false,
      status,
      error: failureMessage(tx) ?? `Transaction ${status.toLowerCase()} on ${entry.network}`,
    });
    return;
  }

  if (!PENDING_STATUSES.has(status) && status !== "UNKNOWN") {
    // Unknown non-pending status: keep polling rather than guessing an outcome.
    update(entry.id, { lastStatus: status });
  }
}

function emitTerminal(result: TerminalResult) {
  terminalListeners.forEach((l) => l(result));
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const entries = load();
    if (entries.length === 0) {
      stopReconciler();
      return;
    }
    await Promise.all(entries.map((e) => reconcileOne(e)));
  } finally {
    ticking = false;
  }
}

/** Runs one reconciliation pass immediately (also used by regression tests). */
export async function reconcileNow() {
  await Promise.all(load().map((e) => reconcileOne(e)));
}

/** Clears all in-memory and persisted pending state. Test helper. */
export function __resetStore() {
  persist([]);
}

/** Polls every pending write, for every account, until each reaches a terminal status. */
export function startReconciler() {
  if (typeof window === "undefined") return;
  if (load().length === 0) return;
  void tick();
  if (timer) return;
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopReconciler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Waits for a specific hash to reach a terminal status. Never times out client-side. */
export function waitForTerminal(hash: string): Promise<TerminalResult> {
  return new Promise((resolve) => {
    const off = onTerminal((r) => {
      if (r.entry.hash.toLowerCase() === hash.toLowerCase()) {
        off();
        resolve(r);
      }
    });
    startReconciler();
  });
}
