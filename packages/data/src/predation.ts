import type { HuntRules } from "@pokuelike/engine";
import { SPECIES } from "./species.js";

/** Derived from each species' `preysOn` list — see species.ts. */
export const HUNT_RULES: HuntRules = Object.fromEntries(
  Object.values(SPECIES)
    .filter((species) => species.preysOn && species.preysOn.length > 0)
    .map((species) => [species.id, species.preysOn!])
);
