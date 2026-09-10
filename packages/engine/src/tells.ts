import type { Agent, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";
import { hasLineOfSight } from "./fov.js";
import { FLEE_DETECT_RADIUS } from "./predation.js";
import { playerFleeRadius } from "./threat.js";
import { trustStage } from "./trust.js";

/**
 * Tells — what an observer can see a creature doing, ROADMAP.md's M4.
 *
 * EMERGENT_SITUATIONS.md: "You cannot participate in a behaviour you cannot
 * identify from outside. Today deliverFood, relocate and explore all look
 * like an animal walking." This is the read. Not eighteen tells for
 * eighteen behaviours: a handful of states a watcher could actually
 * distinguish, and where the sim knows the specific thing (what it is
 * carrying, who it is stalking, which way it is going) the sentence says
 * it. CLAUDE.md's prose rules apply: plain declaratives, name things, no
 * ornament, at most two sentences. The second sentence, when there is one,
 * is whether it has noticed you.
 *
 * Species names come in from the caller (`names`) because the engine does
 * not own display names; the default capitalises the species id.
 */

export interface TellOptions {
  /** The agent doing the looking, for "has noticed you". Omit for a neutral read. */
  observer?: Agent;
  /** Display name per species id ("sandshrew" → "Sandshrew"). Defaults to capitalising the id. */
  name?: (speciesId: string) => string;
}

function defaultName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** "east", "north-west" — from a step or an offset. */
export function compass(dx: number, dy: number): string {
  const ns = dy < 0 ? "north" : dy > 0 ? "south" : "";
  const ew = dx < 0 ? "west" : dx > 0 ? "east" : "";
  return ns && ew ? `${ns}-${ew}` : ns || ew || "nowhere";
}

/** " east", " north-west", or "" when the target is the agent's own tile — seen once in a real sample as "is wandering nowhere". */
function headingTo(from: Vec2, to: Vec2): string {
  const dir = compass(Math.sign(to.x - from.x), Math.sign(to.y - from.y));
  return dir === "nowhere" ? "" : ` ${dir}`;
}

function pronoun(agent: Agent): string {
  return agent.sex === "female" ? "She" : agent.sex === "male" ? "He" : "It";
}

/**
 * Whether `agent` would have noticed `observer`: within the flee-detection
 * radius the sim itself uses (`FLEE_DETECT_RADIUS`, boldness spread
 * ignored) with a clear line of sight. The same test predation.ts runs
 * when deciding whether prey bolts, so "has seen you" here means "will
 * react to you" there.
 */
export function hasNoticed(world: World, agent: Agent, observer: Agent): boolean {
  if (agent.layer !== observer.layer) return false;
  if (agent.asleep || agent.fainted || agent.alive === false) return false;
  // ROADMAP.md M6: for the player, "noticed" is the threat-signature radius
  // predation uses, so "has seen you" still means "will react to you".
  const radius = observer.controlledBy === "player" ? Math.max(1, playerFleeRadius(world, observer, FLEE_DETECT_RADIUS, agent)) : FLEE_DETECT_RADIUS;
  if (Math.hypot(agent.pos.x - observer.pos.x, agent.pos.y - observer.pos.y) > radius) return false;
  const elevation = tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.elevation ?? 0;
  return hasLineOfSight(world, agent.layer, agent.pos, observer.pos, elevation);
}

/** One plain sentence for what `agent` is doing, from the outside. */
export function describeBehavior(world: World, agent: Agent, opts: TellOptions = {}): string {
  const name = opts.name ?? defaultName;
  const me = `The ${name(agent.species)}`;
  const other = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    if (opts.observer && id === opts.observer.id) return "you";
    const a = world.agents.find((x) => x.id === id);
    return a ? `the ${name(a.species)}` : undefined;
  };
  const here = tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.terrain;

  if (agent.isEgg) return "An egg.";
  if (agent.alive === false) return `${me} is dead.`;
  if (agent.fainted) return `${me} is down and not moving.`;
  if (agent.asleep || agent.behavior === "sleep") return `${me} is asleep.`;

  switch (agent.behavior) {
    case "seekWater":
      return here === "water" ? `${me} is drinking.` : `${me} is looking for water.`;
    case "seekFood":
      return here === "food" ? `${me} is eating.` : `${me} is foraging.`;
    case "scavenge":
      return `${me} is eating from a carcass.`;
    case "seekMate":
      return `${me} is looking for a mate.`;
    case "flee": {
      const from = other(agent.fleeingFromId);
      return from ? `${me} is running from ${from}.` : `${me} is running.`;
    }
    case "hunt": {
      const target = other(agent.huntTarget);
      return target ? `${me} is stalking ${target}.` : `${me} is hunting.`;
    }
    case "fight": {
      const target = other(agent.fightTarget);
      return target ? `${me} is fighting ${target}.` : `${me} is fighting.`;
    }
    case "relocate": {
      const dir = agent.relocateTarget ? headingTo(agent.pos, agent.relocateTarget) : "";
      return agent.herdId ? `${me} is travelling${dir} with its herd.` : `${me} is travelling${dir}.`;
    }
    case "explore": {
      const dir = agent.exploreTarget ? headingTo(agent.pos, agent.exploreTarget) : "";
      return `${me} is wandering${dir}.`;
    }
    case "deliverFood": {
      const to = other(agent.deliverTargetId);
      return to ? `${me} is carrying food to ${to}.` : `${me} is carrying food.`;
    }
    case "carryAlly": {
      const who = other(agent.carryingId);
      return who ? `${me} is carrying ${who}.` : `${me} is carrying someone.`;
    }
    case "disperse":
      return `${me} is walking away from its herd.`;
    case "buildShelter":
      return `${me} is building a shelter.`;
    case "restAtShelter":
      return `${me} is resting in its shelter.`;
    case "train":
      return `${me} is training.`;
    case "socialize":
      return `${me} is with its herd.`;
    case "follow": {
      const who = other(agent.followingId);
      return who ? `${me} is following ${who}.` : `${me} is following someone.`;
    }
    case "idle":
      return `${me} is standing still.`;
  }
}

/**
 * The examine line: the tell, then either the noticed/not-noticed sentence
 * (when there is an observer) or a status the eye can see. Two sentences at
 * most.
 */
export function examine(world: World, agent: Agent, opts: TellOptions = {}): string {
  const first = describeBehavior(world, agent, opts);
  if (agent.isEgg || agent.alive === false) return first;
  const p = pronoun(agent);
  if (opts.observer && opts.observer.id !== agent.id) {
    // ROADMAP.md M6: the trust stage is the third sentence, and only once
    // there is something to say — "wary" is the default and says nothing.
    const stage = opts.observer.controlledBy === "player" ? trustStage(world, agent, opts.observer.id) : "wary";
    const trust = stage === "tolerant" ? ` ${p} has stopped watching you.` : stage === "curious" ? ` ${p} comes a little closer.` : stage === "bonded" ? ` ${p} stays beside you.` : "";
    return `${first} ${hasNoticed(world, agent, opts.observer) ? `${p} has seen you.` : `${p} has not noticed you.`}${trust}`;
  }
  if (agent.status) {
    const s = agent.status.kind;
    const word = s === "burn" ? "burned" : s === "poison" ? "poisoned" : s === "paralysis" ? "paralysed" : s === "freeze" ? "frozen" : "asleep";
    return `${first} ${p} is ${word}.`;
  }
  return first;
}
