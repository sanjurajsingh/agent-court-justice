import { Copy } from "lucide-react";
import { toast } from "sonner";

import { shortAddress } from "@/lib/agreement-utils";
import { cn } from "@/lib/utils";

export function AddressChip({
  address,
  label,
  you,
  className,
}: {
  address: string;
  label?: string;
  you?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        toast.success("Address copied");
      }}
      className={cn(
        "group inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground/90 transition-colors hover:border-brass/50",
        className,
      )}
      title={address}
    >
      {label && <span className="text-eyebrow not-italic">{label}</span>}
      <span>{shortAddress(address)}</span>
      {you && <span className="rounded bg-brass/15 px-1 text-[10px] text-brass">YOU</span>}
      <Copy className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
