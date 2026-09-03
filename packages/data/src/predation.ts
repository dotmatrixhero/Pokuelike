import type { HuntRules } from "@pokuelike/engine";
import { SPECIES } from "./species.js";

/**
 * Derived from each species' `isPredator` flag — see species.ts. Which
 * specific nearby agents a flagged hunter actually goes after is decided
 * dynamically at encounter time (relative power, not species identity) —
 * see `@pokuelike/engine`'s predation.ts's `isPreyOf`.
 */
export const HUNT_RULES: HuntRules = Object.fromEntries(
  Object.values(SPECIES)
    .filter((species) => species.isPredator)
    .map((species) => [species.id, true as const])
);
