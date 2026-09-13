import { describe, expect, it } from "vitest";
import { MOVES } from "../src/moves.js";
import { ITEMS, RECIPES } from "../src/crafting.js";
import type { MoveSpec } from "@pokuelike/engine";

/**
 * Direct call: *"No move except like self buffs should have range 0."*
 *
 * `range.min` is the floor `withinMoveRange` checks, so `min: 0` makes the
 * user's OWN tile a legal target. Every curated move shipped with it. The
 * split the command menu already draws is the one that decides here:
 *
 *   - `utilityMove && !terrainEffect` — Growth, Harden, Agility. Instant, no
 *     tile is ever picked. These carry no `range` at all, and must not gain
 *     one; a range on a self-buff would be the thing this test is guarding
 *     against arriving by the back door.
 *   - everything else — attacks AND ground-aimed terrain moves (Fell, Clear)
 *     — goes through pick-a-move-then-pick-a-tile, so its floor is 1.
 */

const isSelfBuff = (m: MoveSpec) => !!m.utilityMove && !m.terrainEffect;

describe("no targetable move can be aimed at the user's own tile", () => {
  const all = Object.values(MOVES) as MoveSpec[];

  it("has both kinds present, so neither branch below is vacuous", () => {
    expect(all.filter(isSelfBuff).length).toBeGreaterThan(0);
    expect(all.filter((m) => !isSelfBuff(m)).length).toBeGreaterThan(0);
  });

  it("every targetable curated move declares range.min >= 1", () => {
    const offenders = all.filter((m) => !isSelfBuff(m) && (m.range?.min ?? 0) < 1).map((m) => m.id);
    expect(offenders).toEqual([]);
  });

  it("self-buffs carry no range at all — they never pick a tile", () => {
    const withRange = all.filter(isSelfBuff).filter((m) => m.range !== undefined).map((m) => m.id);
    expect(withRange).toEqual([]);
  });

  it("move-tree deltas cannot reintroduce a 0 floor", () => {
    const offenders: string[] = [];
    for (const move of all) {
      for (const node of Object.values(move.tree ?? {})) {
        const min = (node as { delta: Partial<MoveSpec> }).delta.range?.min;
        if (min !== undefined && min < 1) offenders.push(`${move.id}/${(node as { id: string }).id}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("item-granted moves obey it too — the axe, the machete, the bare hands", () => {
    const granted: MoveSpec[] = [
      ...Object.values(ITEMS).flatMap((i) => (i as { grantsMoves?: MoveSpec[] }).grantsMoves ?? []),
      ...Object.values(RECIPES).flatMap((r) => (r as { grantsMoves?: MoveSpec[] }).grantsMoves ?? []),
    ];
    // CONTROL: an empty `granted` would pass the assertion below while
    // checking nothing. Fell and Clear are both granted this way.
    expect(granted.map((m) => m.id)).toEqual(expect.arrayContaining(["fell", "clear"]));
    const offenders = granted.filter((m) => !isSelfBuff(m) && (m.range?.min ?? 0) < 1).map((m) => m.id);
    expect(offenders).toEqual([]);
  });
});
