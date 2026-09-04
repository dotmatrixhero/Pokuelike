import type { Agent, Vec2 } from "./types.js";
import type { Disposition } from "./nature.js";
import type { PokemonType } from "./typing.js";

/**
 * A move's area is described as a shape resolved against an origin + facing
 * direction, independent of any specific move. Leveling/spec'ing a move later
 * just swaps or parameterizes the shape (e.g. Ember: point -> ring) without
 * touching how shapes themselves are resolved.
 */
export type Direction = "N" | "S" | "E" | "W";

export type MoveShape =
  | { kind: "point" }
  | { kind: "line"; length: number }
  | { kind: "cone"; length: number; width: number }
  | { kind: "ring"; radius: number }
  | { kind: "burst"; radius: number };

const DIRECTION_VECTORS: Record<Direction, Vec2> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

/**
 * How far a move can be targeted, independent of the shape it resolves once
 * used — a real tactics-grid distinction (cast range vs. effect footprint)
 * that the shape system alone conflates. `max` is the farthest tile a move
 * can be aimed at; `min` (0 for every move today) is reserved for a future
 * thrown-only move that can't be used at melee. See DESIGN.md's "Action
 * economy" section.
 */
export interface MoveRange {
  min: number;
  max: number;
}

export interface MoveSpec {
  id: string;
  name: string;
  shape: MoveShape;
  type: PokemonType;
  category: "physical" | "special";
  /** Mainline-scale base power (Tackle 40, Flamethrower 90, etc.). */
  power: number;
  /** 0-100. Not yet consumed by combat.ts — every move currently hits; see TODO. */
  accuracy: number;
  /** Ticks before this move can be used again. */
  cooldownTicks: number;
  /** e.g. burn chance. Not consumed by anything yet (no status-effect system) — see TODO. */
  statusChance?: number;
  /**
   * Explicit cast range. Optional so specs that predate this field (test
   * fixtures, hand-rolled MoveSpec literals) keep working unchanged —
   * `moveRange()`/`withinMoveRange()` in combat.ts fall back to deriving the
   * old shape-based reach (point=1, line/cone=length) when this is absent.
   * The curated roster in packages/data sets it explicitly.
   */
  range?: MoveRange;
  /**
   * Optional respec DAG (see `applyMoveTree`). Each node is a delta applied
   * on top of the base spec, gated by a point cost and prerequisite node
   * id(s). Absent = this move can't be respec'd (the common case — only
   * moves with an actual designed tree, like Ember, carry one). Wild agents
   * auto-respec into an eligible, affordable node whenever they earn a
   * skill point — see `maybeAutoRespec` (leveling.ts) and DESIGN.md's
   * "Specialization" section.
   */
  tree?: Record<string, MoveTreeNode>;
}

/**
 * One node in a move's respec tree. `delta` is applied on top of whatever
 * the spec looks like after all previously-applied nodes (order given to
 * `applyMoveTree` matters for overwriting fields like `shape`, though
 * numeric deltas like `power`/`cooldownTicks` are additive regardless of
 * order). `prerequisites` must all already be in the chosen set for this
 * node to apply.
 */
export interface MoveTreeNode {
  id: string;
  name: string;
  cost: number;
  prerequisites?: string[];
  /**
   * Alternative prerequisite sets: the node is eligible if it satisfies its
   * (possibly absent) `prerequisites` list AND at least one of these inner
   * arrays is fully satisfied — each inner array is itself AND'd together,
   * same as `prerequisites`, but only one of the arrays needs to hold. This
   * is what lets a crosslink node stand in for a branch's own earlier chain
   * node as an alternate way to reach something downstream (see
   * MOVES_DESIGN.md's "crosslinks" section) — the same shape also covers a
   * keystone reachable from either of two forks. The common authoring
   * pattern is to use this *instead of* `prerequisites`, not alongside it —
   * a node with both must satisfy both (AND between the two mechanisms).
   */
  prerequisitesAnyOf?: string[][];
  /**
   * Node ids this one permanently locks out once chosen, and vice versa —
   * checked in both directions regardless of which side declares it, so a
   * one-sided declaration still works, though authoring both sides is
   * clearer to read. This is the real-fork primitive: two nodes that
   * `excludes` each other are a mutually exclusive, permanent choice (see
   * MOVES_DESIGN.md's skill-tree template). Absent = no exclusivity.
   */
  excludes?: string[];
  /**
   * Which Disposition axis (nature.ts) this node appeals to, if any — used
   * only by `maybeAutoRespec` (leveling.ts) to weight a wild agent's pick
   * among several currently-affordable/eligible nodes on the same tree.
   * Absent means the node has no particular behavioral lean (e.g. a pure
   * numeric buff nobody would pick "because they're bold") and is weighted
   * neutrally. This never gates eligibility or cost — it only nudges *which*
   * eligible node an individual is more likely to grab first.
   */
  leaning?: keyof Disposition;
  delta: {
    shape?: MoveShape;
    range?: Partial<MoveRange>;
    power?: number;
    accuracy?: number;
    cooldownTicks?: number;
    statusChance?: number;
  };
}

/** Resolves the set of tiles (relative to origin, in the given facing) a shape covers. */
export function resolveShape(shape: MoveShape, origin: Vec2, facing: Direction): Vec2[] {
  const forward = DIRECTION_VECTORS[facing];
  const tiles: Vec2[] = [];

  switch (shape.kind) {
    case "point":
      tiles.push({ ...origin });
      break;

    case "line":
      for (let i = 1; i <= shape.length; i++) {
        tiles.push({ x: origin.x + forward.x * i, y: origin.y + forward.y * i });
      }
      break;

    case "cone":
      for (let depth = 1; depth <= shape.length; depth++) {
        const spread = Math.floor((depth * shape.width) / shape.length);
        for (let s = -spread; s <= spread; s++) {
          const perp = { x: -forward.y, y: forward.x };
          tiles.push({
            x: origin.x + forward.x * depth + perp.x * s,
            y: origin.y + forward.y * depth + perp.y * s,
          });
        }
      }
      break;

    case "ring":
      for (let dx = -shape.radius; dx <= shape.radius; dx++) {
        for (let dy = -shape.radius; dy <= shape.radius; dy++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (dist === shape.radius) tiles.push({ x: origin.x + dx, y: origin.y + dy });
        }
      }
      break;

    case "burst":
      for (let dx = -shape.radius; dx <= shape.radius; dx++) {
        for (let dy = -shape.radius; dy <= shape.radius; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= shape.radius) {
            tiles.push({ x: origin.x + dx, y: origin.y + dy });
          }
        }
      }
      break;
  }

  return tiles;
}

/**
 * Derives a new `MoveSpec` by applying a chosen set of a move's tree nodes,
 * in the given order, on top of `base`. Never mutates `base` — every field
 * (including nested `range`) is copied into a fresh object as it's touched,
 * so the canonical `MOVES`/dex data stays untouched no matter what a caller
 * respecs. Throws if `base` has no tree, references an unknown node id, or a
 * node's prerequisites aren't already satisfied by nodes earlier in
 * `chosenNodeIds` — an invalid selection is a caller bug, not something to
 * silently ignore or partially apply.
 *
 * Numeric deltas (power/accuracy/cooldownTicks/statusChance) are additive and
 * order-independent; `shape` and `range` are overwrites, applied in the order
 * given, so a tree that offers alternative branches (e.g. Ember: "grow into
 * a ring" vs. "stay a point but hit faster/more often") depends on the caller
 * choosing one, not both, deltas that touch the same field. Also validates
 * `prerequisitesAnyOf` (satisfying `prerequisites` alone isn't enough if this
 * is set — at least one alternative set must also be fully chosen) and
 * `excludes` (two mutually-exclusive nodes can't both appear in
 * `chosenNodeIds`, checked in both directions) — see `MoveTreeNode`'s own
 * doc comments.
 */
export function applyMoveTree(base: MoveSpec, chosenNodeIds: string[]): MoveSpec {
  const tree = base.tree;
  if (!tree) throw new Error(`applyMoveTree: move "${base.id}" has no respec tree`);

  const chosen = new Set<string>();
  let result: MoveSpec = { ...base, range: base.range ? { ...base.range } : undefined };

  for (const nodeId of chosenNodeIds) {
    const node = tree[nodeId];
    if (!node) throw new Error(`applyMoveTree: move "${base.id}" has no tree node "${nodeId}"`);

    const missing = (node.prerequisites ?? []).filter((prereq) => !chosen.has(prereq));
    if (missing.length > 0) {
      throw new Error(
        `applyMoveTree: node "${nodeId}" on move "${base.id}" requires [${missing.join(", ")}] to be chosen first`
      );
    }

    if (node.prerequisitesAnyOf && node.prerequisitesAnyOf.length > 0) {
      const satisfied = node.prerequisitesAnyOf.some((set) => set.every((prereq) => chosen.has(prereq)));
      if (!satisfied) {
        throw new Error(
          `applyMoveTree: node "${nodeId}" on move "${base.id}" requires one of its alternative prerequisite sets to already be chosen`
        );
      }
    }

    const conflict = [...chosen].find(
      (chosenId) => (node.excludes ?? []).includes(chosenId) || (tree[chosenId]?.excludes ?? []).includes(nodeId)
    );
    if (conflict) {
      throw new Error(`applyMoveTree: node "${nodeId}" on move "${base.id}" conflicts with already-chosen node "${conflict}"`);
    }

    chosen.add(nodeId);

    const { delta } = node;
    result = {
      ...result,
      shape: delta.shape ?? result.shape,
      power: delta.power !== undefined ? result.power + delta.power : result.power,
      accuracy: delta.accuracy !== undefined ? result.accuracy + delta.accuracy : result.accuracy,
      cooldownTicks:
        delta.cooldownTicks !== undefined ? Math.max(0, result.cooldownTicks + delta.cooldownTicks) : result.cooldownTicks,
      statusChance:
        delta.statusChance !== undefined ? (result.statusChance ?? 0) + delta.statusChance : result.statusChance,
      range: delta.range
        ? { min: delta.range.min ?? result.range?.min ?? 0, max: delta.range.max ?? result.range?.max ?? 1 }
        : result.range,
    };
  }

  return result;
}

/** Sum of the chosen nodes' own `cost` fields — what `applyMoveTreeWithSpend` actually charges. */
export function totalTreeCost(base: MoveSpec, chosenNodeIds: string[]): number {
  const tree = base.tree;
  if (!tree) throw new Error(`totalTreeCost: move "${base.id}" has no respec tree`);
  return chosenNodeIds.reduce((sum, id) => {
    const node = tree[id];
    if (!node) throw new Error(`totalTreeCost: move "${base.id}" has no tree node "${id}"`);
    return sum + node.cost;
  }, 0);
}

/**
 * Validates and spends `cost` skill points of `pointType` from `agent`,
 * preferring typed points over wildcard (don't burn the rarer currency
 * first — see DESIGN.md). Returns false and mutates nothing if the agent
 * doesn't have enough (typed + wildcard) to cover `cost`.
 */
export function trySpendSkillPoints(agent: Agent, pointType: PokemonType, cost: number): boolean {
  const typed = agent.skillPoints?.[pointType] ?? 0;
  const wildcard = agent.wildcardSkillPoints ?? 0;
  if (typed + wildcard < cost) return false;

  const spendTyped = Math.min(typed, cost);
  const spendWildcard = cost - spendTyped;
  agent.skillPoints = agent.skillPoints ?? {};
  agent.skillPoints[pointType] = typed - spendTyped;
  agent.wildcardSkillPoints = wildcard - spendWildcard;
  return true;
}

/**
 * The real spend-validation path for `applyMoveTree`: computes the chosen
 * nodes' total cost, tries to pay it out of `agent`'s typed (matching
 * `base.type`) + wildcard skill points (typed preferred), and only derives
 * the respec'd `MoveSpec` — deducting the currency — if that succeeds.
 * Throws (rather than silently no-op'ing) on insufficient points, same
 * failure style as `applyMoveTree`'s own prerequisite/unknown-node checks —
 * an invalid spend attempt is a caller bug to catch, not swallow. Called by
 * `maybeAutoRespec` (leveling.ts) whenever a wild agent's disposition-weighted
 * pick turns out to be affordable — see DESIGN.md's "Specialization" section.
 */
export function applyMoveTreeWithSpend(base: MoveSpec, chosenNodeIds: string[], agent: Agent): MoveSpec {
  const cost = totalTreeCost(base, chosenNodeIds);
  if (!trySpendSkillPoints(agent, base.type, cost)) {
    const typed = agent.skillPoints?.[base.type] ?? 0;
    const wildcard = agent.wildcardSkillPoints ?? 0;
    throw new Error(
      `applyMoveTreeWithSpend: insufficient skill points for "${base.id}" — need ${cost} (${base.type}), have ${typed} typed + ${wildcard} wildcard`
    );
  }
  return applyMoveTree(base, chosenNodeIds);
}
