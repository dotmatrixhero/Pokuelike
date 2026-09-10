/**
 * Real-run validation for wild-human archetypes (immigration.ts's
 * `assignHumanArchetype`) and the threat-signature widening (threat.ts) —
 * direct asks: "can we make humans spawn with different types... could
 * also have items... should also have sex and that should affect which
 * emoji you choose for them", then "make the humans feel a little more
 * like a threat despite having weak stat blocks. plus having valuable
 * loot."
 *
 * Exercises the real functions directly rather than a full macro-world
 * run: a 3x8000-tick `tickMacroWorld` run (this project's standard suite)
 * found 0 wild humans in the focused zone across all three seeds —
 * "human" is one of 108 roster species and ordinary immigration only
 * fires a handful of times total across the WHOLE roster per run (see
 * immigration.ts's own doc comment), so waiting on a natural spawn to
 * verify this is impractical. This calls the same real
 * `spawnAgent`/`assignHumanArchetype`/`threatSignatureOf` the engine
 * calls at its real sites, with the real `IMMIGRATION_CONTEXT` — nothing
 * here is a stub.
 *
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateHumanArchetypes.ts`
 */
import { assignHumanArchetype, threatSignatureOf } from "@pokuelike/engine";
import type { World } from "@pokuelike/engine";
import { IMMIGRATION_CONTEXT, spawnAgent } from "@pokuelike/data";

let rngState = 12345;
function rng(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

const WEAPON_MOVE: Record<string, string> = { flintKnife: "scratch", club: "pound", axe: "fell", machete: "clear" };
const fakeWorld = { tick: 0, items: IMMIGRATION_CONTEXT.itemCatalog!.items } as unknown as World;

const ROLLS = 400;
const archetypeCounts: Record<string, number> = {};
const weaponCounts: Record<string, number> = {};
let merchantBonusCount = 0;
let merchantRolls = 0;
let sawArmedThreatAboveOne = false;
let sawUnarmedWandererAtBaseline = false;

for (let i = 0; i < ROLLS; i++) {
  const agent = spawnAgent("human", `wild-human-${i}`, { x: 0, y: 0 }, 5, rng);
  assignHumanArchetype(agent, IMMIGRATION_CONTEXT, rng);
  const archetype = agent.archetype ?? "none";
  archetypeCounts[archetype] = (archetypeCounts[archetype] ?? 0) + 1;

  if (archetype === "hunter") {
    const weapon = agent.equipment?.held;
    if (!weapon) throw new Error(`hunter ${agent.id} has no held weapon`);
    weaponCounts[weapon] = (weaponCounts[weapon] ?? 0) + 1;
    const expectedMove = WEAPON_MOVE[weapon];
    if (!expectedMove || !(agent.moves ?? []).some((m) => m.id === expectedMove)) {
      throw new Error(`hunter ${agent.id} with ${weapon} should know ${expectedMove}, got: ${agent.moves?.map((m) => m.id)}`);
    }
    const sig = threatSignatureOf(fakeWorld, agent);
    if (sig > 1) sawArmedThreatAboveOne = true;
  }
  if (archetype === "merchant") {
    merchantRolls++;
    const inv = agent.inventory ?? [];
    const hasBonus = inv.some((i) => ["poultice", "foragePouch", "camouflageCloak"].includes(i.itemKey));
    if (hasBonus) merchantBonusCount++;
    if (!inv.some((i) => i.itemKey === "fiber") || !inv.some((i) => i.itemKey === "cordage")) {
      throw new Error(`merchant ${agent.id} missing base trade goods: ${inv.map((i) => i.itemKey)}`);
    }
  }
  if (archetype === "wanderer") {
    const sig = threatSignatureOf(fakeWorld, agent);
    if (sig === 1) sawUnarmedWandererAtBaseline = true;
  }
}

console.log(`${ROLLS} rolls, archetype distribution:`, archetypeCounts);
console.log("hunter weapon distribution:", weaponCounts);
console.log(`merchant bonus wares: ${merchantBonusCount}/${merchantRolls} (~30% expected)`);

if (Object.keys(archetypeCounts).length !== 5) throw new Error(`expected all 5 archetypes to appear, saw: ${Object.keys(archetypeCounts)}`);
if (Object.keys(weaponCounts).length !== 4) throw new Error(`expected all 4 weapon tiers to appear across ${archetypeCounts.hunter} hunters, saw: ${Object.keys(weaponCounts)}`);
if (!sawArmedThreatAboveOne) throw new Error("no armed hunter ever read as more threatening than an unarmed human (signature > 1) — threat-signature widening is broken");
if (!sawUnarmedWandererAtBaseline) throw new Error("no unarmed wanderer read at the plain baseline signature (1) — threat-signature widening is broken");
const bonusRate = merchantBonusCount / merchantRolls;
if (bonusRate < 0.15 || bonusRate > 0.45) throw new Error(`merchant bonus-wares rate ${bonusRate} is far from the intended ~0.3 — check the roll`);

// A wild human with no equipment reads as a plain, un-threatening human — same baseline the player gets unarmed.
const bareWanderer = spawnAgent("human", "bare-wanderer", { x: 0, y: 0 }, 5, rng);
bareWanderer.archetype = "wanderer";
if (threatSignatureOf(fakeWorld, bareWanderer) !== 1) throw new Error("unarmed wild human should read at baseline signature 1");

// The player is untouched: no archetype, no tool-granted extras, still just its bare-hands moveset.
const player = spawnAgent("human", "player", { x: 0, y: 0 }, 5, rng);
player.controlledBy = "player";
assignHumanArchetype(player, IMMIGRATION_CONTEXT, rng);
if (player.archetype !== undefined) throw new Error(`player should never get an archetype, got: ${player.archetype}`);
if ((player.moves ?? []).length !== 1 || player.moves?.[0]?.id !== "tackle") {
  throw new Error(`player moves should be untouched (just tackle), got: ${player.moves?.map((m) => m.id)}`);
}
console.log("player correctly untouched: archetype undefined, moves = [tackle]");
console.log("PASS");
