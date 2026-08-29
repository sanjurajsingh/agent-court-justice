import type { AgreementStatus } from "@/lib/genlayer/agentcourt";
import { cn } from "@/lib/utils";

const STYLES: Record<AgreementStatus, string> = {
  CREATED: "border-border text-muted-foreground",
  FUNDED: "border-consensus/40 text-consensus",
  DELIVERED: "border-consensus/40 text-consensus",
  DISPUTED: "border-dispute/50 text-dispute",
  ADJUDICATED: "border-brass/50 text-brass",
  APPEALED: "border-dispute/50 text-dispute",
  SETTLED: "border-verdict/50 text-verdict",
  CANCELLED: "border-border text-muted-foreground line-through",
};

export function StatusBadge({
  status,
  className,
}: {
  status: AgreementStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-[0.12em] uppercase",
        STYLES[status] ?? "border-border text-muted-foreground",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
