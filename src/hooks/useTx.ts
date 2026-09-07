import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  findPending,
  findPendingByScope,
  onTerminal,
  recordPending,
  startReconciler,
  subscribe,
  type PendingTx,
  type TxPhase,
} from "@/lib/genlayer/tx-store";
import { useWallet } from "@/hooks/useWallet";

export type { TxPhase };

/**
 * Tracks a single GenLayer write from wallet signature to terminal status.
 *
 * The hash is persisted the moment it exists, scoped to the signing account.
 * Pending writes survive a reload, are reconciled by polling until the network
 * reports a terminal status, and can never be resubmitted while unresolved.
 * A client-side read failure is never reported as a transaction failure.
 */
export function useTx(scope: string | number = "default") {
  const { address } = useWallet();
  const scopeKey = String(scope);

  const [phase, setPhase] = useState<TxPhase>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelInFlight, setLabelInFlight] = useState<string | null>(null);
  const [restored, setRestored] = useState<PendingTx | null>(null);
  const submitting = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setHash(null);
    setError(null);
    setLabelInFlight(null);
  }, []);

  // Re-attach to any write this account left in flight (page reload included).
  useEffect(() => {
    if (!address) {
      setRestored(null);
      return;
    }
    const sync = () => setRestored(findPendingByScope(address, scopeKey));
    sync();
    startReconciler();
    return subscribe(sync);
  }, [address, scopeKey]);

  useEffect(() => {
    if (restored && phase === "idle") {
      setPhase("pending");
      setHash(restored.hash);
      setLabelInFlight(restored.label);
    }
  }, [restored, phase]);

  const run = useCallback(
    async (
      label: string,
      submit: () => Promise<string | { hash?: string }>,
    ): Promise<string | null> => {
      if (!address) {
        toast.error("Connect a wallet first");
        return null;
      }
      // Duplicate protection: never resubmit while a write is unresolved.
      if (submitting.current || findPending(address, label, scopeKey)) {
        toast.info("That transaction is already in flight");
        return null;
      }
      submitting.current = true;
      setPhase("confirming");
      setError(null);
      setHash(null);
      setLabelInFlight(label);

      let txHash: string;
      try {
        const result = await submit();
        txHash = typeof result === "string" ? result : String(result?.hash ?? "");
        if (!txHash) throw new Error("Wallet returned no transaction hash");
      } catch (e) {
        // Nothing was accepted by the network: a terminal failure.
        const message = e instanceof Error ? e.message : String(e);
        submitting.current = false;
        setError(message);
        setPhase("error");
        toast.error(`${label} rejected`, { description: message.slice(0, 200) });
        return null;
      }

      // Hash exists: record it immediately, before finality is known.
      recordPending({ account: address, label, scope: scopeKey, hash: txHash });
      setHash(txHash);
      setPhase("pending");
      submitting.current = false;

      return txHash;
    },
    [address, scopeKey],
  );

  // Terminal results arrive from the reconciler, including after a reload.
  const finalizeRef = useRef<(() => void | Promise<void>) | undefined>(undefined);
  const runWithCallback = useCallback(
    async (
      label: string,
      submit: () => Promise<string | { hash?: string }>,
      onFinalized?: () => void | Promise<void>,
    ) => {
      finalizeRef.current = onFinalized;
      return run(label, submit);
    },
    [run],
  );

  useEffect(() => {
    return onTerminal(async (result) => {
      if (!address) return;
      if (result.entry.account.toLowerCase() !== address.toLowerCase()) return;
      if (result.entry.scope !== scopeKey) return;
      setHash(result.entry.hash);
      if (result.ok) {
        setPhase("success");
        setError(null);
        toast.success(`${result.entry.label} finalized on GenLayer`);
      } else {
        setPhase("error");
        setError(result.error ?? `Transaction ${result.status}`);
        toast.error(`${result.entry.label} failed`, {
          description: (result.error ?? result.status).slice(0, 200),
        });
      }
      await finalizeRef.current?.();
    });
  }, [address, scopeKey]);

  return {
    phase,
    hash,
    error,
    run: runWithCallback,
    reset,
    busy: phase === "confirming" || phase === "pending",
  };
}
