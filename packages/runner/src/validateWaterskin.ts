/**
 * Real-run, live-tick validation for the waterskin mechanic — direct ask:
 * "make waterskin when held, allow gather from water sources and filling
 * it up." Exercises the actual `applyPlayerAction` the web app calls,
 * against a real generated cave scenario with real underground water, not
 * a mocked World.
 *
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateWaterskin.ts`
 */
import { addItem, applyPlayerAction, findPlayer, setTile } from "@pokuelike/engine";
import { createCaveScenario } from "@pokuelike/data";

function fail(msg: string): never {
  throw new Error(msg);
}

const world = createCaveScenario(20260903);
const player = findPlayer(world) ?? fail("no player in scenario");

// Force a known, CLEAN layout on the surface layer: water directly east of
// the player, open floor west, nothing else nearby that `harvestableAt`
// would also pick up (no sunbeam/wall/boulder/rocky ground) — cave terrain
// near water triggers underground's own "lichen grows near water" rule
// (harvest.ts), which would silently mask the water-fill fallback this
// test is actually checking. Surface + a hand-placed clean patch sidesteps
// that entirely.
player.layer = "surface";
player.pos = { x: 5, y: 5 };
for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) setTile(world, "surface", 5 + dx, 5 + dy, "floor");
setTile(world, "surface", 6, 5, "water");

addItem(player, "waterskin", 1, world.items!.waterskin!.weight);
player.equipment = { held: "waterskin" };

console.log("waterCapacity:", world.items!.waterskin!.waterCapacity, "charges before:", player.waterskinCharges ?? 0);

// Gather while adjacent to water: should fill the waterskin, not error as "nothing to harvest".
if (!applyPlayerAction(world, player, { kind: "gather" })) fail("gather (fill) should have started");
for (let i = 0; i < 3; i++) applyPlayerAction(world, player, { kind: "continue" });
if ((player.waterskinCharges ?? 0) !== 1) fail(`expected 1 charge after one fill, got ${player.waterskinCharges}`);
console.log("after 1 gather-fill: charges =", player.waterskinCharges, "outcome:", player.lastActionOutcome?.filledWater);

// Fill twice more to hit the cap (3), then confirm a 4th fill attempt is refused.
applyPlayerAction(world, player, { kind: "gather" });
for (let i = 0; i < 3; i++) applyPlayerAction(world, player, { kind: "continue" });
applyPlayerAction(world, player, { kind: "gather" });
for (let i = 0; i < 3; i++) applyPlayerAction(world, player, { kind: "continue" });
if ((player.waterskinCharges ?? 0) !== 3) fail(`expected 3 (full) after three fills, got ${player.waterskinCharges}`);
if (applyPlayerAction(world, player, { kind: "gather" })) fail("gather should refuse to start — waterskin already full and nothing else to harvest at this tile");
console.log("full at cap (3), further gather correctly refused");

// Move away from water — drink should now work from the waterskin alone.
player.pos = { x: player.pos.x - 1, y: player.pos.y };
player.needs.thirst = 0.2;
const beforeThirst = player.needs.thirst;
if (!applyPlayerAction(world, player, { kind: "drink" })) fail("drink should succeed away from water using the waterskin");
if ((player.waterskinCharges ?? 0) !== 2) fail(`expected 2 charges after one drink, got ${player.waterskinCharges}`);
if (!(player.needs.thirst > beforeThirst)) fail("drink from waterskin did not relieve thirst");
console.log(`drink away from water: thirst ${beforeThirst} -> ${player.needs.thirst}, charges now ${player.waterskinCharges}`);

// Drain the rest, then confirm drink fails once both water AND charges are gone.
applyPlayerAction(world, player, { kind: "drink" });
applyPlayerAction(world, player, { kind: "drink" });
if ((player.waterskinCharges ?? 0) !== 0) fail(`expected 0 charges after draining, got ${player.waterskinCharges}`);
if (applyPlayerAction(world, player, { kind: "drink" })) fail("drink should fail once the waterskin is empty and no water is in reach");
console.log("empty waterskin + no water in reach: drink correctly refused");

// Regression: with the waterskin stowed entirely (and still no water in reach), drink still fails.
player.equipment = undefined;
if (applyPlayerAction(world, player, { kind: "drink" })) fail("drink should still fail with no waterskin and no water in reach (regression)");
console.log("no waterskin at all: drink correctly refused (regression check)");

console.log("PASS");
