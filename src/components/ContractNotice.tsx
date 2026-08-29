import { AGENTCOURT_ADDRESS, NETWORK } from "@/lib/genlayer/config";

/**
 * The dApp refuses to render contract data unless a real deployed address is
 * configured. Nothing is ever mocked or hardcoded in its place.
 */
export function ContractNotice() {
  if (AGENTCOURT_ADDRESS) return null;
  return (
    <div className="mb-6 rounded-md border border-dispute/40 bg-dispute/10 px-4 py-3 text-sm text-dispute">
      <p className="font-medium">No AgentCourt contract configured.</p>
      <p className="mt-1 text-dispute/90">
        Deploy <code className="font-mono">contracts/agentcourt.py</code> to {NETWORK} and set{" "}
        <code className="font-mono">VITE_AGENTCOURT_ADDRESS</code>. Until then no agreement data can
        be read — AgentCourt never substitutes placeholder state.
      </p>
    </div>
  );
}

export const hasContract = () => Boolean(AGENTCOURT_ADDRESS);
