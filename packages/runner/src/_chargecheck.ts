import { MOVES } from "@pokuelike/data";
/** Can ONE build hold both a chargeAttack node and a hitsArea/burst node? */
for (const m of Object.values(MOVES as any) as any[]) {
  if (!m.tree) continue;
  const nodes = Object.values(m.tree) as any[];
  const charge = nodes.filter((n) => n.delta?.chargeAttack !== undefined);
  const area = nodes.filter((n) => n.delta?.hitsArea !== undefined || n.delta?.shape?.kind === "burst" || n.delta?.shape?.kind === "cone");
  if (!charge.length || !area.length) continue;
  // excludes are symmetric-ish; check if every charge/area pair is mutually excluded
  const blocked = charge.every((c) => area.every((a) =>
    (c.excludes ?? []).includes(a.id) || (a.excludes ?? []).includes(c.id)));
  console.log(`${m.id.padEnd(14)} charge:[${charge.map((n)=>n.id).join(",")}]  area:[${area.map((n)=>n.id).join(",")}]  ${blocked ? "mutually excluded — safe" : "CO-TAKEABLE — area is silently lost"}`);
}

console.log("\n-- peck specifically --");
const peck: any = (MOVES as any).peck;
for (const n of Object.values(peck.tree) as any[]) {
  if (n.delta?.chargeAttack || n.delta?.hitsArea || n.delta?.areaBonus !== undefined || n.delta?.shape) {
    console.log(`  ${n.id.padEnd(22)} ${JSON.stringify({ chargeAttack: n.delta.chargeAttack, hitsArea: n.delta.hitsArea, areaBonus: n.delta.areaBonus, shape: n.delta.shape })}  excludes=${JSON.stringify(n.excludes ?? [])}`);
  }
}
