// Hand-curated (not scraped) — see the script's ITEMS section and DESIGN.md.

/**
 * A curated ~30 classic held items relevant to damage math. PokeRogue's full
 * item/modifier system (shop economy, held-item stacking rules, hundreds of
 * items) is enormous and out of scope — see TODO.md. Not wired into combat.ts.
 */
export interface ItemDexEntry {
  id: string;
  name: string;
  effect: string;
  category: string;
}

export const ITEM_DEX: ItemDexEntry[] = [
  {
    id: "choice_band",
    name: "Choice Band",
    effect: "1.5x Attack; locks the holder into its first move until it switches out.",
    category: "choice"
  },
  {
    id: "choice_specs",
    name: "Choice Specs",
    effect: "1.5x Special Attack; locks the holder into its first move until it switches out.",
    category: "choice"
  },
  {
    id: "choice_scarf",
    name: "Choice Scarf",
    effect: "1.5x Speed; locks the holder into its first move until it switches out.",
    category: "choice"
  },
  {
    id: "life_orb",
    name: "Life Orb",
    effect: "1.3x damage on attacking moves; holder loses 10% max HP after each hit that deals damage.",
    category: "damage-boost"
  },
  {
    id: "expert_belt",
    name: "Expert Belt",
    effect: "1.2x damage when a move is super effective.",
    category: "damage-boost"
  },
  {
    id: "muscle_band",
    name: "Muscle Band",
    effect: "1.1x damage on physical moves.",
    category: "damage-boost"
  },
  {
    id: "wise_glasses",
    name: "Wise Glasses",
    effect: "1.1x damage on special moves.",
    category: "damage-boost"
  },
  {
    id: "eviolite",
    name: "Eviolite",
    effect: "1.5x Defense and Special Defense, if the holder can still evolve.",
    category: "defense"
  },
  {
    id: "assault_vest",
    name: "Assault Vest",
    effect: "1.5x Special Defense; holder cannot use status moves.",
    category: "defense"
  },
  {
    id: "leftovers",
    name: "Leftovers",
    effect: "Restores 1/16 max HP at the end of each turn.",
    category: "recovery"
  },
  {
    id: "black_sludge",
    name: "Black Sludge",
    effect: "Restores 1/16 max HP per turn for Poison types; damages 1/8 max HP per turn for all others.",
    category: "recovery"
  },
  {
    id: "shell_bell",
    name: "Shell Bell",
    effect: "Restores 1/8 of the damage the holder deals as HP.",
    category: "recovery"
  },
  {
    id: "focus_sash",
    name: "Focus Sash",
    effect: "Survives an otherwise-fatal hit at 1 HP, if at full HP beforehand; consumed on use.",
    category: "survival"
  },
  {
    id: "focus_band",
    name: "Focus Band",
    effect: "10% chance to survive an otherwise-fatal hit at 1 HP.",
    category: "survival"
  },
  {
    id: "sitrus_berry",
    name: "Sitrus Berry",
    effect: "Restores 25% max HP when HP drops below 50%; consumed on use.",
    category: "berry"
  },
  {
    id: "lum_berry",
    name: "Lum Berry",
    effect: "Cures the holder of any status condition or confusion; consumed on use.",
    category: "berry"
  },
  {
    id: "weakness_policy",
    name: "Weakness Policy",
    effect: "+2 Attack and Special Attack when hit by a super-effective move; consumed on use.",
    category: "situational-boost"
  },
  {
    id: "rocky_helmet",
    name: "Rocky Helmet",
    effect: "Deals 1/6 max HP to any attacker that makes contact with the holder.",
    category: "retaliation"
  },
  {
    id: "type_gem",
    name: "Type Gem (generic)",
    effect: "1.5x power on the next move of the matching type; consumed on use. One item per type (Fire Gem, Water Gem, etc.).",
    category: "one-shot-boost"
  },
  {
    id: "type_plate",
    name: "Type Plate (generic)",
    effect: "1.2x power on moves of the matching type; also changes Arceus's type. One item per type (Flame Plate, Splash Plate, etc.).",
    category: "type-boost"
  },
  {
    id: "silk_scarf",
    name: "Silk Scarf",
    effect: "1.2x power on Normal-type moves.",
    category: "type-boost"
  },
  {
    id: "black_belt",
    name: "Black Belt",
    effect: "1.2x power on Fighting-type moves.",
    category: "type-boost"
  },
  {
    id: "charcoal",
    name: "Charcoal",
    effect: "1.2x power on Fire-type moves.",
    category: "type-boost"
  },
  {
    id: "mystic_water",
    name: "Mystic Water",
    effect: "1.2x power on Water-type moves.",
    category: "type-boost"
  },
  {
    id: "magnet",
    name: "Magnet",
    effect: "1.2x power on Electric-type moves.",
    category: "type-boost"
  },
  {
    id: "miracle_seed",
    name: "Miracle Seed",
    effect: "1.2x power on Grass-type moves.",
    category: "type-boost"
  },
  {
    id: "never_melt_ice",
    name: "NeverMeltIce",
    effect: "1.2x power on Ice-type moves.",
    category: "type-boost"
  },
  {
    id: "scope_lens",
    name: "Scope Lens",
    effect: "+1 critical-hit stage.",
    category: "crit-boost"
  },
  {
    id: "razor_claw",
    name: "Razor Claw",
    effect: "+1 critical-hit stage.",
    category: "crit-boost"
  },
  {
    id: "king_s_rock",
    name: "King's Rock",
    effect: "Adds a 10% flinch chance to moves that don't already flinch.",
    category: "secondary-effect"
  }
];

