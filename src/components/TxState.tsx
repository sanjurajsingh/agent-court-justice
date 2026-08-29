import { CheckCircle2, CircleAlert, Loader2, Wallet } from "lucide-react";

import type { TxPhase } from "@/hooks/useTx";
import { shortAddress } from "@/lib/agreement-utils";

const COPY: Record<Exclude<TxPhase, "idle">, string> = {
  confirming: "Waiting for wallet confirmation…",
  pending: "Transaction submitted — awaiting GenLayer finality…",
  success: "Finalized on-chain",
  error: "Transaction failed",
};

export function TxState({
  phase,
  hash,
  error,
  label,
}: {
  phase: TxPhase;
  hash?: string | null;
  error?: string | null;
  label?: string;
}) {
  if (phase === "idle") return null;

  const Icon =
    phase === "success" ? CheckCircle2 : phase === "error" ? CircleAlert : phase === "confirming" ? Wallet : Loader2;

  const tone =
    phase === "success" ? "text-verdict" : phase === "error" ? "text-destructive" : "text-consensus";

  return (
    <div className="panel mt-4 p-3 text-sm">
      <div className={`flex items-center gap-2 ${tone}`}>
        <Icon className={`size-4 ${phase === "pending" ? "animate-spin" : ""}`} />
        <span>
          {label ? `${label}: ` : ""}
          {COPY[phase]}
        </span>
      </div>
      {hash && (
        <p className="mt-2 font-mono text-xs break-all text-muted-foreground">tx {shortAddress(hash, 8)}</p>
      )}
      {error && <p className="mt-2 text-xs text-destructive/90">{error}</p>}
    </div>
  );
}
