import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { applyCommandedAction } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct report: *"when you command an ally to target enemy. It just doesn't
 * really land unless they're positioned properly."*
 *
 * `applyCommandedAction` measured range with `manhattan` while `player.ts`'s
 * own targeted swing uses Chebyshev. Everything here moves 8-directionally, so
 * a diagonally-adjacent partner is ONE step from its target and manhattan
 * called that two — the partner sidestepped to an orthogonal tile before it
 * would swing. In open ground that costs a turn. Boxed in, it never resolves.
 */

function mk(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "venonat",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 },
    behavior: "idle",
    hp: 60,
    maxHp: 60,
    stats: { maxHp: 60, attack: 25, defense: 10, spAttack: 10, spDefense: 10, speed: 20 },
    moves: [
      { id: "tackle", name: "Tackle", type: "normal", category: "physical", power: 40, accuracy: 100, pp: 20, cooldownTicks: 2, shape: { kind: "point" }, range: { min: 0, max: 1 } },
    ],
    ...extra,
  } as unknown as Agent;
}

/** Ally at (10,10), foe offset by (dx,dy), player glued to the ally so the leash never trips. */
function fight(dx: number, dy: number, wall?: (w: World) => void) {
  const world = createWorld(20, 20, 3);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTile(world, "surface", x, y, "floor");
  const player = mk("player", 10, 10, { controlledBy: "player" });
  const ally = mk("ally", 10, 10, { followingId: "player" });
  const foe = mk("foe", 10 + dx, 10 + dy, { species: "machop" });
  world.agents.push(player, ally, foe);
  wall?.(world);
  ally.commandedAction = { moveId: "tackle", target: { ...foe.pos }, targetAgentId: foe.id };

  const rng = mulberry32(5);
  let hits = 0;
  for (let i = 0; i < 12; i++) {
    player.pos = { ...ally.pos };
    foe.pos = { x: 10 + dx, y: 10 + dy };
    const before = foe.hp ?? 0;
    applyCommandedAction(world, ally, new EventLog(), undefined, rng);
    if ((foe.hp ?? 0) < before) hits++;
    ally.moveCooldowns = {};
    world.tick++;
  }
  return { hits, ally, foe };
}

describe("a commanded ally uses the same reach the player does", () => {
  it("swings on the FIRST tick from a diagonal, not after a sidestep", () => {
    const diagonal = fight(1, 1);
    const orthogonal = fight(1, 0);
    expect(diagonal.hits).toBe(orthogonal.hits);
    // Under manhattan the diagonal case spent its first tick stepping.
    expect(diagonal.ally.pos).toEqual({ x: 10, y: 10 });
  });

  it("lands it even when boxed in and unable to sidestep — the case that never self-corrected", () => {
    // Walls on every side except the diagonal the foe occupies, so the old
    // "just walks one step closer next tick" escape hatch does not exist.
    const boxed = fight(1, 1, (w) => {
      for (const [x, y] of [
        [9, 9], [10, 9], [11, 9],
        [9, 10], [11, 10],
        [9, 11], [10, 11],
      ] as const) {
        setTile(w, "surface", x, y, "wall");
      }
    });
    expect(boxed.hits).toBeGreaterThan(0);
    expect(boxed.foe.hp!).toBeLessThan(60);
  });

  it("still walks toward a target that is genuinely out of reach", () => {
    const far = fight(5, 0);
    expect(far.ally.pos).not.toEqual({ x: 10, y: 10 });
  });
});
