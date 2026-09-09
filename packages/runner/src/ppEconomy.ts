/**
 * PP as skill-tree currency: how many uses a move gets if a notable makes it
 * cost N PP per use, given the move's real canon pool. Direct steer: "more pp
 * tradeoffs are the play. Notables that require pp. It becomes a gate."
 */
import { MOVES } from "@pokuelike/data";
const rows = (Object.values(MOVES) as any[])
  .filter((m) => m.pp != null)
  .sort((a, b) => a.pp - b.pp);
console.log("move             pool   uses@1  @2  @3  @4   what a heavy notable costs you");
for (const m of rows) {
  const u = (c: number) => Math.floor(m.pp / c);
  const verdict =
    m.pp <= 10 ? "one heavy node and you are dry — gate is HARD" :
    m.pp <= 20 ? "affords one heavy node, or two mid" :
    "affords a real heavy build";
  console.log(`${m.id.padEnd(16)} ${String(m.pp).padStart(4)} ${String(u(1)).padStart(7)} ${String(u(2)).padStart(3)} ${String(u(3)).padStart(3)} ${String(u(4)).padStart(3)}   ${verdict}`);
}
const band = (lo: number, hi: number) => rows.filter((m) => m.pp >= lo && m.pp <= hi).length;
console.log(`\nPool bands: 5-10 PP: ${band(5, 10)} moves | 15-20: ${band(15, 20)} | 25-40: ${band(25, 40)}`);
console.log("The gate is free: it falls out of canon PP, which already tracks move power.");
