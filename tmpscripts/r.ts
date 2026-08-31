import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
const address = "0x1a78e3F82d3d3d574D0A9d54Ca57b155f00392A5" as `0x${string}`;
const c = createClient({ chain: studionet } as never) as any;
for (const fn of ["get_next_id", "get_escrow_balance"]) {
  try { console.log(fn, "=>", String(await c.readContract({ address, functionName: fn, args: [] }))); }
  catch (e:any) { console.log(fn, "ERR", e?.message); }
}
try { console.log("get_agreement(1) =>", JSON.stringify(await c.readContract({address, functionName:"get_agreement", args:[1]}))); } catch(e:any){ console.log("get_agreement(1) ERR", e?.message); }
try { console.log("get_agreements_for =>", JSON.stringify(await c.readContract({address, functionName:"get_agreements_for", args:["0x0000000000000000000000000000000000000000"]}))); } catch(e:any){ console.log("agf ERR", e?.message); }
