# Agent Court Justice

We are starting a new project called AgentCourt.

Build it specifically for the GenLayer ecosystem, targeting the Onchain Justice and Agentic Economy Infrastructure tracks.

Before writing frontend UI, design the complete architecture around a real GenLayer Intelligent Contract. The core product is an evidence-based dispute-resolution and escrow protocol for human ↔ human, human ↔ AI agent, and AI agent ↔ AI agent agreements.

The critical decision MUST happen inside the GenLayer Intelligent Contract, not in Supabase, a backend server, or an external Claude/OpenAI API. GenLayer consensus must evaluate the agreed natural-language terms and submitted evidence, produce a structured adjudication result, and cause an on-chain settlement of escrowed native GEN.

Core flow:

create agreement → fund escrow → deliverable → dispute → evidence from both parties → GenLayer adjudication → consensus → settlement

The contract should support:

 agreements between two wallet addresses

 natural-language agreement terms and acceptance criteria

 native GEN escrow

 deliverable/evidence submission

 opening a dispute

 evidence from both parties

 GenLayer adjudication using the agreed terms + evidence

 structured winner/award/reason output

 full or partial settlement

 duplicate-settlement protection

 insufficient-balance protection

 unauthorized-action protection

 appeal flow compatible with GenLayer's consensus model

 agreement/dispute/decision history

The frontend may use Supabase only for non-consensus-critical file storage and metadata if needed. Do NOT put adjudication, escrow accounting, winner selection, or settlement decisions in Supabase.

Use the current GenLayer Intelligent Contract APIs and current Equivalence Principle patterns from the official documentation. Do not use deprecated GenLayer APIs. Verify the exact current APIs before implementing.

First, create:

contracts/agentcourt.py

and the GenLayer client/config layer needed later by the frontend.

Do not build the full frontend yet.

First report:

 proposed contract architecture

 storage schema

 public methods

 adjudication logic

 settlement logic

 appeal design

 security/invariant checks

 how the Equivalence Principle will be applied

 tests we should write

Then implement the contract only after checking the design against the current GenLayer documentation.

## Development

Requires Node.js and npm (install with [nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
