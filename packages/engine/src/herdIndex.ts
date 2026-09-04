import type { Agent, World } from "./types.js";

interface HerdIndex {
  tick: number;
  byHerd: Map<string, Agent[]>;
}

/**
 * Keyed by World object identity, same convention as resourceIndex.ts's
 * cache — a fresh world always starts with no stale entry, and a
 * garbage-collected World's cache entry is reclaimable too.
 */
const cache = new WeakMap<World, HerdIndex>();

function buildIndex(world: World): HerdIndex {
  const byHerd = new Map<string, Agent[]>();
  for (const agent of world.agents) {
    if (agent.alive === false || !agent.herdId) continue;
    let members = byHerd.get(agent.herdId);
    if (!members) {
      members = [];
      byHerd.set(agent.herdId, members);
    }
    members.push(agent);
  }
  return { tick: world.tick, byHerd };
}

/**
 * Living members of `herdId`, cached once per world tick rather than
 * rescanning all of `world.agents` on every call — the same
 * naive-scan-becomes-a-bottleneck-at-scale problem `resourceIndex.ts`
 * already solved for terrain lookups, now hitting herd-membership lookups
 * too. Unlike `resourceIndex.ts`'s `resourceVersion` (bumped only on a real
 * terrain change), herd membership can shift on essentially any tick
 * (deaths, births, dispersal), so this simply keys off `world.tick` itself
 * — cheap to compare, and correct without needing a second counter someone
 * has to remember to bump. Built lazily on first lookup each tick, not
 * eagerly, so a tick with no herd-aware queries at all pays nothing.
 *
 * Real motivating case: `status.ts`'s `applyHealAuraPassive` ran on every
 * living agent's every tick and, for anyone actually carrying the
 * `healAura` passive, scanned the *entire* population looking for same-herd
 * neighbors — turning a growing population into an O(agents²) cost per
 * tick (confirmed: 500 ticks in ~2.2s, 2000 ticks in ~10.9s on the same
 * seed, a clearly superlinear curve driven by population growth, not tick
 * count). Swapping that scan to `herdMembers(world, agent.herdId)` bounds
 * the per-holder cost to herd size instead of total population.
 */
export function herdMembers(world: World, herdId: string): readonly Agent[] {
  let entry = cache.get(world);
  if (!entry || entry.tick !== world.tick) {
    entry = buildIndex(world);
    cache.set(world, entry);
  }
  return entry.byHerd.get(herdId) ?? [];
}
