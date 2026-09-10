import type { Agent } from "./types.js";

/**
 * Stacks — ROADMAP.md M5. One stack per item key, stable order (first
 * added stays first), so the inventory list never reshuffles under a
 * thumb. `support.ts`'s herd food-delivery predates this and keeps pushing
 * count-1 food items; `addItem` merges those too.
 */

export function countOf(agent: Agent, itemKey: string): number {
  return (agent.inventory ?? []).find((i) => i.itemKey === itemKey)?.count ?? 0;
}

export function carriedWeight(agent: Agent): number {
  return (agent.inventory ?? []).reduce((sum, i) => sum + i.weight * i.count, 0);
}

/** Adds `count` of an item, merging into the existing stack for that key. */
export function addItem(agent: Agent, itemKey: string, count: number, weightEach: number): void {
  if (count <= 0) return;
  const inv = (agent.inventory ??= []);
  const stack = inv.find((i) => i.itemKey === itemKey);
  if (stack) stack.count += count;
  else inv.push({ itemKey, weight: weightEach, count });
}

/** Removes `count` of an item. Returns false and changes nothing if the agent has fewer. */
export function removeItem(agent: Agent, itemKey: string, count: number): boolean {
  const inv = agent.inventory ?? [];
  const idx = inv.findIndex((i) => i.itemKey === itemKey);
  if (idx === -1 || inv[idx]!.count < count) return false;
  inv[idx]!.count -= count;
  if (inv[idx]!.count === 0) inv.splice(idx, 1);
  return true;
}

/** True when every `{itemKey, count}` in `needs` is carried. */
export function hasAll(agent: Agent, needs: readonly { itemKey: string; count: number }[]): boolean {
  return needs.every((n) => countOf(agent, n.itemKey) >= n.count);
}
