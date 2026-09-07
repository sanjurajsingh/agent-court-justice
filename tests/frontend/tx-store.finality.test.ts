import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/* ---- environment: localStorage + a controllable GenLayer read client ---- */

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

const store = new MemoryStorage();
(globalThis as any).window = { localStorage: store };
(globalThis as any).localStorage = store;

let nextResponse: () => unknown = () => ({ status: "PENDING" });

void mock.module("@/lib/genlayer/client", () => ({
  getReadClient: () => ({
    getTransaction: async () => nextResponse(),
  }),
  getWalletClient: async () => {
    throw new Error("not used");
  },
  getInjectedProvider: () => null,
}));

const {
  __resetStore,
  findPending,
  findPendingByScope,
  listPending,
  onTerminal,
  recordPending,
  reconcileNow,
  stopReconciler,
} = await import("@/lib/genlayer/tx-store");

const ACCOUNT_A = "0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA";
const ACCOUNT_B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";

function submit(hash: string, account = ACCOUNT_A, label = "settle", scope = "1") {
  return recordPending({ account, label, scope, hash });
}

beforeEach(() => {
  __resetStore();
  nextResponse = () => ({ status: "PENDING" });
});
afterEach(() => stopReconciler());

describe("steward finality cases", () => {
  test("submitted hash is retained immediately, before any finality is known", () => {
    const entry = submit("0x1");
    expect(entry.hash).toBe("0x1");
    expect(entry.lastStatus).toBe("SUBMITTED");
    expect(findPending(ACCOUNT_A, "settle", "1")?.hash).toBe("0x1");
  });

  test("ACCEPTED is pending, never terminal", async () => {
    submit("0x2");
    let terminal = 0;
    const off = onTerminal(() => terminal++);
    nextResponse = () => ({ status: "ACCEPTED" });
    await reconcileNow();
    expect(terminal).toBe(0);
    expect(findPending(ACCOUNT_A, "settle", "1")?.lastStatus).toBe("ACCEPTED");
    off();
  });

  test("polling continues until a terminal status is reached", async () => {
    submit("0x3");
    const seen: string[] = [];
    const off = onTerminal((r) => seen.push(r.status));
    const sequence = ["PENDING", "ACCEPTED", "ACCEPTED", "FINALIZED"];
    let i = 0;
    nextResponse = () => ({ status: sequence[Math.min(i++, sequence.length - 1)] });
    for (let n = 0; n < 4; n++) await reconcileNow();
    expect(seen).toEqual(["FINALIZED"]);
    expect(findPending(ACCOUNT_A, "settle", "1")).toBeNull();
    off();
  });

  test("a read failure or client timeout keeps a known hash pending", async () => {
    submit("0x4");
    let terminal = 0;
    const off = onTerminal(() => terminal++);
    nextResponse = () => {
      throw new Error("fetch timeout");
    };
    await reconcileNow();
    expect(terminal).toBe(0);
    const still = findPending(ACCOUNT_A, "settle", "1");
    expect(still?.hash).toBe("0x4");
    expect(still?.lastPollError).toContain("timeout");
    off();
  });

  test("an unresolved write blocks a duplicate submission of the same action", () => {
    submit("0x5");
    expect(findPending(ACCOUNT_A, "settle", "1")).not.toBeNull();
    // Same account + label + scope resolves to a single identity.
    submit("0x5-again");
    expect(listPending(ACCOUNT_A).filter((e) => e.label === "settle").length).toBe(1);
  });

  test("pending state survives a reload (rehydrates from storage)", async () => {
    submit("0x6");
    const reloaded = await import(`@/lib/genlayer/tx-store?reload=${Date.now()}`);
    expect(reloaded.listPending(ACCOUNT_A)[0].hash).toBe("0x6");
  });

  test("pending writes are scoped to the originating wallet", () => {
    submit("0x7", ACCOUNT_A);
    submit("0x8", ACCOUNT_B);
    expect(listPending(ACCOUNT_A).map((e) => e.hash)).toEqual(["0x7"]);
    expect(listPending(ACCOUNT_B).map((e) => e.hash)).toEqual(["0x8"]);
    expect(findPendingByScope(ACCOUNT_B, "1")?.hash).toBe("0x8");
  });

  test("switching accounts never resolves or retries the other account's tx", async () => {
    submit("0x9", ACCOUNT_A);
    const results: string[] = [];
    const off = onTerminal((r) => results.push(r.entry.account));
    nextResponse = () => ({ status: "FINALIZED" });
    await reconcileNow();
    expect(results).toEqual([ACCOUNT_A]);
    expect(listPending(ACCOUNT_B)).toEqual([]);
    off();
  });

  test("a reverted transaction becomes a terminal failure", async () => {
    submit("0xa");
    const results: Array<{ ok: boolean; status: string }> = [];
    const off = onTerminal((r) => results.push({ ok: r.ok, status: r.status }));
    nextResponse = () => ({ status: "REVERTED" });
    await reconcileNow();
    expect(results).toEqual([{ ok: false, status: "REVERTED" }]);
    expect(listPending(ACCOUNT_A)).toEqual([]);
    off();
  });

  test("a finalized transaction whose execution errored is reported as failed", async () => {
    submit("0xb");
    const results: Array<{ ok: boolean; error?: string }> = [];
    const off = onTerminal((r) => results.push({ ok: r.ok, error: r.error }));
    nextResponse = () => ({
      status: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    });
    await reconcileNow();
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("ERROR");
    off();
  });

  test("a finalized successful transaction resolves once and clears", async () => {
    submit("0xc");
    let count = 0;
    const off = onTerminal((r) => r.ok && count++);
    nextResponse = () => ({
      status: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    });
    await reconcileNow();
    await reconcileNow();
    expect(count).toBe(1);
    expect(listPending()).toEqual([]);
    off();
  });
});
