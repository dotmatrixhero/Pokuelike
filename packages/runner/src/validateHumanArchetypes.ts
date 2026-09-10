/**
 * Real-run validation for wild-human archetypes (immigration.ts's
 * `assignHumanArchetype`) — direct ask: "can we make humans spawn with
 * different types... could also have items... should also have sex and
 * that should affect which emoji you choose for them."
 *
 * Exercises the real function directly rather than a full macro-world run:
 * a 3x8000-tick `tickMacroWorld` run (this project's standard suite) found
 * 0 wild humans in the focused zone across all three seeds — "human" is
 * one of 108 roster species and ordinary immigration only fires a handful
 * of times total across the WHOLE roster per run (see immigration.ts's own
 * doc comment), so waiting on a natural spawn to verify this is
 * impractical. This calls the same real `spawnAgent`/`assignHumanArchetype`
 * the engine calls at both its real sites (immigration.ts's arrival path,
 * overworld.ts's `promoteZone`), with the real `IMMIGRATION_CONTEXT`
 * (including its `itemCatalog`) — nothing here is a stub.
 *
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateHumanArchetypes.ts`
 */
import { assignHumanArchetype } from "@pokuelike/engine";
import { IMMIGRATION_CONTEXT, spawnAgent } from "@pokuelike/data";

let rngState = 12345;
function rng(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

const ROLLS = 200;
const counts: Record<string, number> = {};
let sawGrantedMove = false;
for (let i = 0; i < ROLLS; i++) {
  const agent = spawnAgent("human", `wild-human-${i}`, { x: 0, y: 0 }, 5, rng);
  assignHumanArchetype(agent, IMMIGRATION_CONTEXT, rng);
  const archetype = agent.archetype ?? "none";
  counts[archetype] = (counts[archetype] ?? 0) + 1;
  if (archetype === "hunter" && !(agent.moves ?? []).some((m) => m.id === "scratch")) {
    throw new Error(`hunter ${agent.id} should have gained Scratch from its flint knife, got: ${agent.moves?.map((m) => m.id)}`);
  }
  if ((agent.moves ?? []).some((m) => m.id === "scratch")) sawGrantedMove = true;
}
console.log(`${ROLLS} rolls, archetype distribution:`, counts);
if (!sawGrantedMove) throw new Error("never saw a tool-granted move across 200 rolls — flintKnife -> Scratch wiring is broken");
if (Object.keys(counts).length !== 5) throw new Error(`expected all 5 archetypes to appear in ${ROLLS} rolls, saw: ${Object.keys(counts)}`);

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
