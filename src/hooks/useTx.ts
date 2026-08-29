import { useCallback, useState } from "react";
import { toast } from "sonner";

export type TxPhase = "idle" | "confirming" | "pending" | "success" | "error";

export interface TxResult {
  hash?: string;
  receipt?: unknown;
}

/**
 * Tracks a single GenLayer write through wallet confirmation, mempool
 * inclusion and finalization. Every phase reflects the real transaction —
 * nothing is simulated.
 */
export function useTx() {
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setHash(null);
    setError(null);
  }, []);

  const run = useCallback(
    async <T extends TxResult>(
      label: string,
      fn: () => Promise<T>,
      onDone?: (result: T) => void | Promise<void>,
    ): Promise<T | null> => {
      setPhase("confirming");
      setError(null);
      setHash(null);
      try {
        const promise = fn();
        setPhase("pending");
        const result = await promise;
        if (result?.hash) setHash(String(result.hash));
        setPhase("success");
        toast.success(`${label} finalized on GenLayer`);
        await onDone?.(result);
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setPhase("error");
        toast.error(`${label} failed`, { description: message.slice(0, 200) });
        return null;
      }
    },
    [],
  );

  return { phase, hash, error, run, reset, busy: phase === "confirming" || phase === "pending" };
}
