import { describe, expect, it } from "vitest";
import { createMacroWorld, generateMacroGrid, tileAt } from "../src/index.js";
import type { ImmigrationContext, World } from "../src/index.js";

/**
 * A deliberately minimal context: these tests are about TERRAIN and presence,
 * not about the data package's roster, so villagers are stubbed rather than
 * spawned through real species data (the engine package cannot import it).
 */
const CTX: ImmigrationContext = {
  speciesRoster: [],
  spawnAgent: (speciesId, id, pos, level) =>
    ({ id, species: speciesId, pos, layer: "surface", homeLayer: "surface", level, behavior: "idle", needs: { hunger: 0, thirst: 0, energy: 1, mateDrive: 0 }, moves: [] }) as never,
};

function count(world: World, terrain: string): number {
  let n = 0;
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if (tileAt(world, "surface", x, y)?.terrain === terrain) n++;
  return n;
}
function promote(row: number, col: number): World {
  const grid = generateMacroGrid(11, 64, 64);
  const mw = createMacroWorld(grid, row, col, 11, 90, 60, CTX);
  return mw.regions.get(`${row},${col}`)!.world!;
}

describe("settlement placement", () => {
  const grid = generateMacroGrid(11, 64, 64);
  const living = grid.history!.settlements.find((s) => s.status === "living")!;
  const ruined = grid.history!.settlements.find((s) => s.status === "ruined");

  it("puts a real town — homes, a palisade and people — where a living settlement sits", () => {
    const world = promote(living.row, living.col);
    expect(world.settlement?.name).toBe(living.name);
    expect(world.settlement?.status).toBe("living");
    expect(count(world, "shelter")).toBeGreaterThan(0);
    // The palisade is the "build walls, keep lethal" decision made real. It
    // was silently 0 once, because chooseCenter maximised nearby WATER and
    // put the town on a sliver where the whole ring fell in the sea.
    expect(count(world, "wall")).toBeGreaterThan(0);
    expect(world.agents.filter((a) => a.settlementRole).length).toBeGreaterThan(0);
  });

  it.runIf(ruined)("leaves a ruin standing empty, with its cause recorded", () => {
    const world = promote(ruined!.row, ruined!.col);
    expect(world.settlement?.status).toBe("ruined");
    expect(world.settlement?.ruinedCause).toBeTruthy();
    // The absence IS the content — a ruin with villagers in it is not a ruin.
    expect(world.agents.filter((a) => a.settlementRole).length).toBe(0);
  });

  it("works fields outside the wall, and a ruin has none", () => {
    const world = promote(living.row, living.col);
    expect(world.settlement?.fieldTiles).toBeGreaterThan(0);

    // Fields are the WORKED ring: outside the palisade, where they are
    // reachable and raidable, not tucked safely inside the town.
    const center = world.settlement!.center;
    let outside = 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const tile = tileAt(world, "surface", x, y);
        if (!tile?.flavor) continue;
        if (tile.terrain !== "food" && tile.terrain !== "seedling") continue;
        if (Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) > 7) outside++;
      }
    }
    expect(outside).toBeGreaterThan(0);

    if (ruined) {
      // A ruin's fields went back to the wild generations ago; the absence is
      // part of what makes it read as a ruin.
      expect(promote(ruined.row, ruined.col).settlement?.fieldTiles).toBe(0);
    }
  });

  it("leaves wilderness alone — the control", () => {
    const occupied = new Set(grid.history!.settlements.map((s) => `${s.row},${s.col}`));
    const wild = grid.zones.find((z) => !z.isOcean && !occupied.has(`${z.row},${z.col}`))!;
    const world = promote(wild.row, wild.col);
    expect(world.settlement).toBeUndefined();
    expect(world.agents.filter((a) => a.settlementRole).length).toBe(0);
    // Wild flora still germinates out here — the control is that no
    // settlement record exists to have laid fields, not that food is absent.
    expect(world.settlement?.fieldTiles ?? 0).toBe(0);
  });
});
