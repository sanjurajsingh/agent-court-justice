import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Gavel, Landmark, ScrollText, Vault } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { getEscrowBalance, listAgreements } from "@/lib/genlayer/agentcourt";
import { NETWORK } from "@/lib/genlayer/config";
import { gen, isContested } from "@/lib/agreement-utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AgentCourt, Evidence-Based Dispute Resolution Onchain" },
      {
        name: "description",
        content:
          "Escrow, evidence and arbitration for human and AI-agent agreements. Verdicts are decided inside a GenLayer Intelligent Contract.",
      },
      { property: "og:title", content: "AgentCourt, Evidence-Based Dispute Resolution Onchain" },
      {
        property: "og:description",
        content:
          "Escrow, evidence and arbitration for human and AI-agent agreements, judged by GenLayer consensus.",
      },
    ],
  }),
  component: Home,
});

const FLOW = [
  {
    icon: ScrollText,
    title: "Agreement",
    body: "Two parties, human or agent, record natural-language terms and acceptance criteria on-chain.",
  },
  {
    icon: Vault,
    title: "Escrow",
    body: "The client funds native GEN into the contract. Neither party can move it unilaterally.",
  },
  {
    icon: FileText,
    title: "Evidence",
    body: "Deliverables, URIs and statements are appended to an immutable, ordered case file.",
  },
  {
    icon: Gavel,
    title: "GenLayer Adjudication",
    body: "Validators independently reason over the case file and must converge on the verdict under the Equivalence Principle.",
  },
  {
    icon: Landmark,
    title: "Settlement",
    body: "The contract executes its own judgment and transfers real GEN to the awarded parties.",
  },
];

function Home() {
  const enabled = hasContract();
  const { data: agreements } = useQuery({
    queryKey: ["agreements"],
    queryFn: listAgreements,
    enabled,
  });
  const { data: escrow } = useQuery({
    queryKey: ["escrow-balance"],
    queryFn: getEscrowBalance,
    enabled,
  });

  const total = agreements?.length;
  const disputes = agreements?.filter((a) => isContested(a.status)).length;
  const settled = agreements?.filter((a) => a.status === "SETTLED").length;

  return (
    <div>
      <section className="court-grid relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--brass)_14%,transparent),transparent_60%)]" />
        <div className="relative mx-auto max-w-6xl px-5 py-24">
          <p className="text-eyebrow">Onchain justice · GenLayer {NETWORK}</p>
          <h1 className="mt-5 max-w-3xl text-5xl leading-[1.05] md:text-6xl">
            Evidence-based dispute resolution for the agent economy.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            AgentCourt escrows value, records the case file and lets a GenLayer Intelligent Contract
            deliver the verdict. Human ↔ human, human ↔ agent, agent ↔ agent, the same court.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/create">
                Create agreement <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/agreements">Explore agreements</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-border px-5 md:grid-cols-4">
          <Stat label="Agreements" value={total} />
          <Stat label="Open disputes" value={disputes} />
          <Stat label="Settled" value={settled} />
          <Stat label="Escrow held" value={escrow !== undefined ? `${gen(escrow, 3)} GEN` : undefined} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <ContractNotice />
        <p className="text-eyebrow">The protocol</p>
        <h2 className="mt-3 text-3xl">Agreement → Escrow → Evidence → Adjudication → Settlement</h2>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
          {FLOW.map((step, i) => (
            <li key={step.title} className="bg-card p-5">
              <span className="text-eyebrow">Step {i + 1}</span>
              <step.icon className="mt-4 size-5 text-brass" />
              <h3 className="mt-3 text-lg">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-border bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 md:grid-cols-2">
          <div>
            <p className="text-eyebrow">Why GenLayer is required</p>
            <h2 className="mt-3 text-3xl">A contract that can actually read the evidence.</h2>
            <p className="mt-5 text-muted-foreground">
              Ordinary smart contracts cannot interpret "the API must match the spec" or weigh a
              screenshot against a promise. They can only move money on numeric triggers, which is
              why disputes always fall back to an off-chain human, a multisig or a centralized
              arbitrator, a trust hole in the middle of the escrow.
            </p>
            <p className="mt-4 text-muted-foreground">
              GenLayer Intelligent Contracts execute non-deterministic reasoning under validator
              consensus. AgentCourt's <code className="font-mono text-brass">adjudicate()</code>{" "}
              method asks each validator to judge the same case file, and the Equivalence Principle
              requires them to agree on the winner and to land within 500 bps of the same split
              before the verdict is written to state.
            </p>
          </div>
          <div className="panel p-6">
            <p className="text-eyebrow">Equivalence Principle</p>
            <div className="mt-5 space-y-3">
              {["Leader reasons over the case file", "Validators re-run the judgment", "Winner must match exactly", "Award split must agree within 500 bps", "Verdict written to contract state"].map(
                (line, i) => (
                  <div key={line} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-consensus/40 font-mono text-[11px] text-consensus">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground/90">{line}</span>
                  </div>
                ),
              )}
            </div>
            <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
              If validators disagree, no verdict is recorded and no funds move. The judgment lives in
              the contract, never in this interface, and never in an off-chain model call.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="px-5 py-7">
      <p className="text-eyebrow">{label}</p>
      <p className="mt-2 font-mono text-2xl text-foreground">
        {value === undefined ? <span className="text-muted-foreground">-</span> : value}
      </p>
    </div>
  );
}
