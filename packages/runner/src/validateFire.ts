/**
 * Fire hazard validation — does a real fire actually behave like a fire?
 *
 * Structural tests prove each rule in isolation; this measures the emergent
 * shape: how big a burn gets, how long it lasts, whether it stays bounded
 * by fuel rather than eating the map, and whether standing in one is
 * actually lethal. Run: `npx tsx packages/runner/src/validateFire.ts`
 */
import { createWorld, setTile, tileAt, tickFires, applyFireDamage, igniteTile, mulberry32, EventLog } from "@pokuelike/engine";
import type { TerrainKind, World } from "@pokuelike/engine";

function countTerrain(world: World, kind: TerrainKind): number {
  let n = 0;
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) if (tileAt(world, "surface", x, y)?.terrain === kind) n++;
  return n;
}

/** A dense field of fuel with a given coverage, so we can see whether fire is bounded by fuel density. */
function fuelField(size: number, coverage: number, seed: number): World {
  const world = createWorld(size, size);
  world.weatherCells = [];
  const rng = mulberry32(seed);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (rng() < coverage) setTile(world, "surface", x, y, "flora");
  return world;
}

console.log("=== burn size vs fuel coverage (40x40 field, fire lit at centre, run to burnout) ===");
for (const coverage of [0.2, 0.4, 0.6, 0.8, 1.0]) {
  const sizes: number[] = [];
  const durations: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const world = fuelField(40, coverage, seed);
    const fuelBefore = countTerrain(world, "flora");
    setTile(world, "surface", 20, 20, "flora");
    igniteTile(world, "surface", 20, 20);
    const rng = mulberry32(seed * 7919);
    let ticks = 0;
    while (countTerrain(world, "fire") > 0 && ticks < 2000) {
      tickFires(world, undefined, rng);
      ticks++;
    }
    const fuelAfter = countTerrain(world, "flora");
    sizes.push(fuelBefore - fuelAfter);
    durations.push(ticks);
  }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(
    `coverage ${(coverage * 100).toFixed(0).padStart(3)}%  burned ${avg(sizes).toFixed(1).padStart(7)} tiles` +
      ` (max ${Math.max(...sizes)})  lasted ${avg(durations).toFixed(1).padStart(6)} ticks (max ${Math.max(...durations)})`
  );
}

console.log("\n=== is it lethal? an agent that stands still in fire, by max HP ===");
for (const maxHp of [30, 50, 70]) {
  for (const regen of [0, 0.03, 0.11]) {
    const world = createWorld(5, 5);
    world.weatherCells = [];
    setTile(world, "surface", 2, 2, "flora");
    const agent: any = {
      id: "a",
      species: "test",
      pos: { x: 2, y: 2 },
      layer: "surface",
      homeLayer: "surface",
      needs: { hunger: 1, thirst: 1, energy: 1 },
      behavior: "idle",
      hp: maxHp,
      maxHp,
      passives: { regen },
    };
    world.agents.push(agent);
    igniteTile(world, "surface", 2, 2);
    const rng = mulberry32(4242);
    let ticks = 0;
    while (agent.alive !== false && ticks < 500) {
      // Re-light so the tile never runs out — this measures lethality of
      // standing in fire, not how long one patch of fuel lasts.
      igniteTile(world, "surface", 2, 2);
      applyFireDamage(world, undefined, rng);
      ticks++;
    }
    console.log(
      `maxHp ${String(maxHp).padStart(2)}  regen ${(regen * 100).toFixed(0).padStart(2)}%/tick  ` +
        (agent.alive === false ? `died after ${ticks} ticks in fire` : `SURVIVED 500 ticks — fire is not a threat to this build`)
    );
  }
}

console.log("\n=== does rain put it out? (same 40x40 field at 80% fuel, fully rained on) ===");
for (const wet of [false, true]) {
  const world = fuelField(40, 0.8, 99);
  if (wet) world.weatherCells = [{ type: "rain", center: { x: 20, y: 20 }, radius: 40, ticksRemaining: 9999 } as never];
  const before = countTerrain(world, "flora");
  setTile(world, "surface", 20, 20, "flora");
  igniteTile(world, "surface", 20, 20);
  const rng = mulberry32(31337);
  let ticks = 0;
  while (countTerrain(world, "fire") > 0 && ticks < 2000) {
    tickFires(world, undefined, rng);
    ticks++;
  }
  console.log(`${wet ? "rain " : "clear"}: burned ${before - countTerrain(world, "flora")} tiles over ${ticks} ticks`);
}
