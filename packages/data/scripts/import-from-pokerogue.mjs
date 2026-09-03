#!/usr/bin/env node
/**
 * Regenerates packages/data/src/dex/{species,moves,abilities,type-chart,items}.ts
 * from a local checkout of the PokeRogue fork (dotmatrixhero/poke_the_spire or
 * pagefaultgames/pokerogue — anything with the same source layout).
 *
 * Usage:
 *   node packages/data/scripts/import-from-pokerogue.mjs /path/to/poke_the_spire
 *
 * This parses the source .ts files as *text* (regex/balanced-bracket scanning) —
 * it does not import or execute PokeRogue's TypeScript (its `#app/`-style path
 * aliases don't resolve standalone anyway). It is best-effort: PokeRogue's move
 * file in particular is ~13k lines of chained builder calls, so a handful of
 * exotic entries may be skipped (logged to stderr) rather than crash the import.
 * Re-run this whenever PokeRogue updates and diff the output.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const srcRoot = process.argv[2];
if (!srcRoot) {
  console.error("usage: node import-from-pokerogue.mjs <path-to-poke_the_spire>");
  process.exit(1);
}
const src = (p) => join(srcRoot, "src", p);
const read = (p) => readFileSync(src(p), "utf8");

const outDir = join(import.meta.dirname, "..", "src", "dex");
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Small text-scanning helpers (no TS parser available/needed — see header)
// ---------------------------------------------------------------------------

/** Enum-ish `NAME = value,` / `NAME,` blocks -> { NAME: number }, auto-incrementing like TS enums. */
function parseEnum(text, enumName) {
  const start = text.indexOf(`enum ${enumName}`);
  const bodyStart = text.indexOf("{", start);
  const bodyEnd = matchBrace(text, bodyStart);
  const body = text.slice(bodyStart + 1, bodyEnd);
  const map = {};
  let next = 0;
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*(=\s*(-?\d+))?\s*,?\s*$/);
    if (!m) continue;
    const val = m[3] !== undefined ? Number(m[3]) : next;
    map[m[1]] = val;
    next = val + 1;
  }
  return map;
}

/** Find the index of the `}` (or `)`) matching the bracket at `openIdx`, counting only that bracket pair. */
function matchBrace(text, openIdx, open = "{", close = "}") {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced ${open}${close} starting at ${openIdx}`);
}

function titleCase(enumKey, overrides) {
  if (overrides[enumKey]) return overrides[enumKey];
  return enumKey
    .toLowerCase()
    .split("_")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Known oddities where TITLE_CASE(enum key) doesn't match the real display name.
const SPECIES_NAME_OVERRIDES = {
  NIDORAN_F: "Nidoran♀",
  NIDORAN_M: "Nidoran♂",
  MR_MIME: "Mr. Mime",
  MIME_JR: "Mime Jr.",
  MR_RIME: "Mr. Rime",
  FARFETCHD: "Farfetch'd",
  SIRFETCHD: "Sirfetch'd",
  HO_OH: "Ho-Oh",
  PORYGON_Z: "Porygon-Z",
  JANGMO_O: "Jangmo-o",
  HAKAMO_O: "Hakamo-o",
  KOMMO_O: "Kommo-o",
  TYPE_NULL: "Type: Null",
  WO_CHIEN: "Wo-Chien",
  CHIEN_PAO: "Chien-Pao",
  TING_LU: "Ting-Lu",
  CHI_YU: "Chi-Yu",
  GREAT_TUSK: "Great Tusk",
  IRON_TREADS: "Iron Treads",
};
const MOVE_NAME_OVERRIDES = {}; // move display names title-case cleanly in practice

console.error("Parsing enums...");
const speciesIdText = read("enums/species-id.ts");
const moveIdText = read("enums/move-id.ts");
const abilityIdText = read("enums/ability-id.ts");
const typeIdText = read("enums/pokemon-type.ts");

const SpeciesId = parseEnum(speciesIdText, "SpeciesId");
const MoveId = parseEnum(moveIdText, "MoveId");
const AbilityId = parseEnum(abilityIdText, "AbilityId");
const PokemonTypeEnum = parseEnum(typeIdText, "PokemonType"); // includes UNKNOWN=-1, STELLAR

const speciesIdToName = Object.fromEntries(Object.keys(SpeciesId).map((k) => [SpeciesId[k], titleCase(k, SPECIES_NAME_OVERRIDES)]));
const moveIdToName = Object.fromEntries(Object.keys(MoveId).map((k) => [MoveId[k], titleCase(k, MOVE_NAME_OVERRIDES)]));
const abilityIdToName = Object.fromEntries(Object.keys(AbilityId).map((k) => [AbilityId[k], titleCase(k, {})]));
const typeIdToName = Object.fromEntries(Object.keys(PokemonTypeEnum).map((k) => [PokemonTypeEnum[k], k.toLowerCase()]));

// ---------------------------------------------------------------------------
// Type effectiveness chart (src/data/type.ts): nested `switch (defType) { case X: switch(attackType) { case Y: return N } }`
// ---------------------------------------------------------------------------
console.error("Parsing type chart...");
function parseTypeChart() {
  const text = read("data/type.ts");
  const fnStart = text.indexOf("function getTypeChartMultiplier");
  const outerSwitchStart = text.indexOf("switch (defType)", fnStart);
  const outerBraceStart = text.indexOf("{", outerSwitchStart);
  const outerBraceEnd = matchBrace(text, outerBraceStart);
  const outerBody = text.slice(outerBraceStart + 1, outerBraceEnd);

  // Walk outerBody tracking brace depth so we only treat "case PokemonType.X:" as a
  // defType label when it's at depth 0 (i.e. NOT inside a nested `switch (attackType)`
  // block's own case labels, which use the identical syntax one level deeper).
  const chart = {}; // attackTypeName -> { defTypeName -> multiplier }
  let depth = 0;
  let pendingDefTypes = [];
  const caseLabelRe = /case PokemonType\.([A-Z_]+):/y;
  const switchAttackRe = /switch \(attackType\)/y;

  for (let i = 0; i < outerBody.length; i++) {
    const ch = outerBody[i];
    if (depth === 0) {
      caseLabelRe.lastIndex = i;
      const cm = caseLabelRe.exec(outerBody);
      if (cm) {
        pendingDefTypes.push(cm[1]);
        i = caseLabelRe.lastIndex - 1;
        continue;
      }
      switchAttackRe.lastIndex = i;
      const sm = switchAttackRe.exec(outerBody);
      if (sm && pendingDefTypes.length) {
        const braceStart = outerBody.indexOf("{", switchAttackRe.lastIndex);
        const braceEnd = matchBrace(outerBody, braceStart);
        const innerBody = outerBody.slice(braceStart + 1, braceEnd);

        const groupRe = /((?:case PokemonType\.[A-Z_]+:\s*)+)\s*return\s+([\d.]+);/g;
        let gm;
        while ((gm = groupRe.exec(innerBody))) {
          const attackTypes = [...gm[1].matchAll(/case PokemonType\.([A-Z_]+):/g)].map((x) => x[1]);
          const mult = Number(gm[2]);
          for (const at of attackTypes) {
            for (const defName of pendingDefTypes) {
              chart[at] ??= {};
              chart[at][defName] = mult;
            }
          }
        }
        pendingDefTypes = [];
        i = braceEnd; // depth stays 0; we've consumed the whole inner switch block
        continue;
      }
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return chart;
}
const typeChart = parseTypeChart();

// ---------------------------------------------------------------------------
// Moves (src/data/moves/move.ts)
// ---------------------------------------------------------------------------
console.error("Parsing moves...");
function parseMoves() {
  const text = read("data/moves/move.ts");
  const initIdx = text.indexOf("export function initMoves()");
  const pushIdx = text.indexOf("(allMoves as Move[]).push(", initIdx);
  const pushParenStart = text.indexOf("(", pushIdx + "(allMoves as Move[]).push".length);
  const pushParenEnd = matchBrace(text, pushParenStart, "(", ")");
  const body = text.slice(pushParenStart + 1, pushParenEnd);

  const startRe = /new (AttackMove|StatusMove|SelfStatusMove|ChargingAttackMove|VariablePowerAttackMove)\(/g;
  const starts = [];
  let sm;
  while ((sm = startRe.exec(body))) {
    starts.push({ cls: sm[1], idx: sm.index, parenIdx: startRe.lastIndex - 1 });
  }

  const moves = [];
  let skipped = 0;
  for (let i = 0; i < starts.length; i++) {
    const { cls, idx, parenIdx } = starts[i];
    let ctorEnd;
    try {
      ctorEnd = matchBrace(body, parenIdx, "(", ")");
    } catch {
      skipped++;
      continue;
    }
    const ctorArgs = body.slice(parenIdx + 1, ctorEnd);
    const chainEnd = i + 1 < starts.length ? starts[i + 1].idx : body.length;
    const chainText = body.slice(ctorEnd + 1, chainEnd);

    const idMatch = ctorArgs.match(/^\s*MoveId\.([A-Z0-9_]+)/);
    if (!idMatch) {
      skipped++;
      continue;
    }
    const moveId = MoveId[idMatch[1]];
    if (moveId === undefined) {
      // Referenced in move.ts but commented out of the MoveId enum (e.g. disabled G-Max
      // moves) — not a real, currently-numbered move. Skip rather than emit a bad id.
      skipped++;
      continue;
    }
    const typeMatch = ctorArgs.match(/PokemonType\.([A-Z]+)/);
    const type = typeMatch ? typeMatch[1].toLowerCase() : "normal";

    const isAttackLike = cls === "AttackMove" || cls === "ChargingAttackMove" || cls === "VariablePowerAttackMove";
    // AttackMove-like: (id, type, category, power, accuracy, pp, chance, priority, generation)
    // Status/SelfStatus-like: (id, type, accuracy, pp, chance, priority, generation) — always STATUS category.
    // Filter to purely-numeric tokens so an explicit MoveCategory arg on an otherwise
    // status-shaped call (e.g. the MoveId.NONE placeholder) doesn't shift the count.
    const nums = ctorArgs
      .split(",")
      .slice(2)
      .map((s) => s.trim())
      .filter((s) => s.length && Number.isFinite(Number(s)))
      .map(Number);
    let category, power, accuracy, pp, chance, priority, generation;
    if (isAttackLike) {
      const catMatch = ctorArgs.match(/MoveCategory\.(\w+)/);
      category = catMatch ? catMatch[1].toLowerCase() : "physical";
      [power, accuracy, pp, chance, priority, generation] = nums;
    } else {
      category = "status";
      power = 0;
      if (nums.length === 4) {
        // The MoveId.NONE placeholder passes an explicit MoveCategory arg and omits
        // accuracy entirely (a status move against yourself always "hits") — one args
        // shorter than every other Status/SelfStatusMove call in this file.
        [pp, chance, priority, generation] = nums;
        accuracy = -1;
      } else {
        [accuracy, pp, chance, priority, generation] = nums;
      }
    }

    const tags = [...chainText.matchAll(/\.attr\(\s*([A-Za-z0-9_]+)/g)].map((x) => x[1]);
    const targetMatch = chainText.match(/\.target\(\s*MoveTarget\.([A-Z0-9_]+)/);
    const flagMethods = [
      "makesContact",
      "punchingMove",
      "slicingMove",
      "soundBased",
      "ballBombMove",
      "windMove",
      "triageMove",
      "pulseMove",
      "biteMove",
      "danceMove",
      "powderMove",
      "reflectable",
      "recklessMove",
      "bypassSturdy",
      "edgeCase",
    ];
    const flags = [];
    for (const fm of flagMethods) {
      const re = new RegExp(`\\.${fm}\\(\\s*(false)?\\s*\\)`);
      const fmMatch = chainText.match(re);
      if (fmMatch) {
        // makesContact(false) means it does NOT make contact — record the negative explicitly.
        flags.push(fmMatch[1] === "false" ? `no${fm[0].toUpperCase()}${fm.slice(1)}` : fm);
      }
    }

    moves.push({
      id: moveId,
      key: idMatch[1],
      name: moveIdToName[moveId] ?? titleCase(idMatch[1], MOVE_NAME_OVERRIDES),
      type,
      category,
      power,
      accuracy,
      pp,
      effectChance: chance,
      priority,
      generation,
      target: targetMatch ? targetMatch[1] : undefined,
      flags,
      tags: [...new Set(tags)],
    });
  }
  console.error(`  moves: ${moves.length} parsed, ${skipped} skipped`);
  return moves;
}
const moves = parseMoves();

// ---------------------------------------------------------------------------
// Abilities (src/data/abilities/init-abilities.ts) — id/name + attr-name tag list
// (no plain-text descriptions ship in this repo; see dex/abilities.ts header).
// ---------------------------------------------------------------------------
console.error("Parsing abilities...");
function parseAbilities() {
  const text = read("data/abilities/init-abilities.ts");
  const initIdx = text.indexOf("export function initAbilities()");
  const pushIdx = text.indexOf("(allAbilities as Ability[]).push(", initIdx);
  const pushParenStart = text.indexOf("(", pushIdx + "(allAbilities as Ability[]).push".length);
  const pushParenEnd = matchBrace(text, pushParenStart, "(", ")");
  const body = text.slice(pushParenStart + 1, pushParenEnd);

  const startRe = /new AbBuilder\(AbilityId\.([A-Z0-9_]+)/g;
  const starts = [];
  let sm;
  while ((sm = startRe.exec(body))) starts.push({ key: sm[1], idx: sm.index });

  const abilities = [];
  for (let i = 0; i < starts.length; i++) {
    const chainStart = starts[i].idx;
    const chainEnd = i + 1 < starts.length ? starts[i + 1].idx : body.length;
    const chainText = body.slice(chainStart, chainEnd);
    const id = AbilityId[starts[i].key];
    const tags = [...new Set([...chainText.matchAll(/\.attr\(\s*([A-Za-z0-9_]+)/g)].map((x) => x[1]))];
    const ignorable = /\.ignorable\(\)/.test(chainText);
    abilities.push({
      id,
      key: starts[i].key,
      name: abilityIdToName[id] ?? titleCase(starts[i].key, {}),
      tags,
      ignorable,
    });
  }
  console.error(`  abilities: ${abilities.length} parsed`);
  return abilities;
}
const abilities = parseAbilities();

// ---------------------------------------------------------------------------
// Species (src/data/balance/species/generation-0{1..9}.ts) — base forms only.
// ---------------------------------------------------------------------------
console.error("Parsing species...");
function parseGrowthRateEnum() {
  const text = read("data/exp.ts");
  return parseEnum(text, "GrowthRate");
}
function parseEggTierEnum() {
  const text = read("enums/egg-type.ts");
  return parseEnum(text, "EggTier");
}
const GrowthRate = parseGrowthRateEnum();
const growthRateToName = Object.fromEntries(Object.keys(GrowthRate).map((k) => [GrowthRate[k], k]));
const EggTier = parseEggTierEnum();
const eggTierToName = Object.fromEntries(Object.keys(EggTier).map((k) => [EggTier[k], k]));

function extractField(text, field, isString = false) {
  const re = isString
    ? new RegExp(`${field}:\\s*"([^"]*)"`)
    : new RegExp(`${field}:\\s*(null|[A-Za-z0-9_.]+)`);
  const m = text.match(re);
  return m ? m[1] : undefined;
}

function parseEvolutions(blockText) {
  const marker = "evolutions:";
  const markerIdx = blockText.indexOf(marker);
  if (markerIdx === -1) return [];
  const bracketStart = blockText.indexOf("[", markerIdx);
  const bracketEnd = matchBrace(blockText, bracketStart, "[", "]");
  const arrText = blockText.slice(bracketStart + 1, bracketEnd);

  const evoStartRe = /new Species(?:Form)?Evolution\(\{/g;
  const evos = [];
  let m;
  while ((m = evoStartRe.exec(arrText))) {
    const braceStart = arrText.indexOf("{", m.index);
    const braceEnd = matchBrace(arrText, braceStart, "{", "}");
    const inner = arrText.slice(braceStart + 1, braceEnd);
    const speciesIdMatch = inner.match(/speciesId:\s*SpeciesId\.([A-Z0-9_]+)/);
    if (!speciesIdMatch) continue;
    const targetId = SpeciesId[speciesIdMatch[1]];
    const levelMatch = inner.match(/level:\s*(-?\d+)/);
    // Shallow key: value pairs at this nesting level (skip nested arrays/objects/functions) — a
    // freeform "conditions" bag covering item/time-of-day/trade/etc. without modeling each one.
    const conditions = {};
    const kvRe = /([A-Za-z0-9_]+):\s*([^,{}[\]]+?)(?=,\s*[A-Za-z0-9_]+:|,?\s*$)/g;
    let kv;
    while ((kv = kvRe.exec(inner))) {
      const key = kv[1];
      if (key === "speciesId" || key === "level") continue;
      conditions[key] = kv[2].trim();
    }
    evos.push({
      target: targetId,
      targetName: speciesIdToName[targetId],
      level: levelMatch ? Number(levelMatch[1]) : undefined,
      conditions,
    });
  }
  return evos;
}

function parseGenerationFile(genNum) {
  const text = read(`data/balance/species/generation-0${genNum}.ts`);
  const entryRe = /generationOne\w*SpeciesData\[SpeciesId\.([A-Z0-9_]+)\]\s*=\s*\{|generation\w+SpeciesData\[SpeciesId\.([A-Z0-9_]+)\]\s*=\s*\{/g;
  // Actual variable name differs per file (generationOneSpeciesData, generationTwoSpeciesData, ...);
  // match generically on "SpeciesData[SpeciesId.NAME] = {".
  const genericRe = /\w+SpeciesData\[SpeciesId\.([A-Z0-9_]+)\]\s*=\s*\{/g;
  const starts = [];
  let m;
  while ((m = genericRe.exec(text))) starts.push({ key: m[1], idx: m.index, braceIdx: genericRe.lastIndex - 1 });

  const species = [];
  for (let i = 0; i < starts.length; i++) {
    const braceEnd = matchBrace(text, starts[i].braceIdx, "{", "}");
    const block = text.slice(starts[i].braceIdx + 1, braceEnd);

    const speciesCtorIdx = block.indexOf("new PokemonSpecies(");
    if (speciesCtorIdx === -1) continue;
    const cfgParenStart = block.indexOf("(", speciesCtorIdx);
    const cfgParenEnd = matchBrace(block, cfgParenStart, "(", ")");
    const cfgText = block.slice(cfgParenStart + 1, cfgParenEnd);
    // Base-form scalar fields all appear before any `forms:` sibling array (alt forms nest their own
    // copies of the same field names, which would otherwise shadow the base ones) — see script header.
    const formsIdx = cfgText.search(/\n\s*forms:\s*\[/);
    const baseText = formsIdx === -1 ? cfgText : cfgText.slice(0, formsIdx);

    const key = starts[i].key;
    const id = SpeciesId[key];
    if (id === undefined) continue;

    const type1 = extractField(baseText, "type1")?.replace("PokemonType.", "");
    const type2Raw = extractField(baseText, "type2");
    const type2 = type2Raw && type2Raw !== "null" ? type2Raw.replace("PokemonType.", "") : undefined;
    const malePercentRaw = extractField(baseText, "malePercent");
    const malePercent = malePercentRaw === "null" || malePercentRaw === undefined ? null : Number(malePercentRaw);
    const ability1 = extractField(baseText, "ability1")?.replace("AbilityId.", "");
    const ability2Raw = extractField(baseText, "ability2")?.replace("AbilityId.", "");
    const ability2 = ability2Raw && ability2Raw !== "NONE" ? ability2Raw : undefined;
    const abilityHiddenRaw = extractField(baseText, "abilityHidden")?.replace("AbilityId.", "");
    const abilityHidden = abilityHiddenRaw && abilityHiddenRaw !== "NONE" ? abilityHiddenRaw : undefined;
    const growthRateRaw = extractField(baseText, "growthRate")?.replace("GrowthRate.", "");

    const eggTierRaw = extractField(block, "eggTier")?.replace("EggTier.", "");

    species.push({
      id,
      key,
      name: speciesIdToName[id] ?? titleCase(key, SPECIES_NAME_OVERRIDES),
      generation: genNum,
      types: [type1, type2].filter(Boolean).map((t) => t.toLowerCase()),
      baseStats: {
        hp: Number(extractField(baseText, "baseHp")),
        attack: Number(extractField(baseText, "baseAtk")),
        defense: Number(extractField(baseText, "baseDef")),
        spAttack: Number(extractField(baseText, "baseSpatk")),
        spDefense: Number(extractField(baseText, "baseSpdef")),
        speed: Number(extractField(baseText, "baseSpd")),
      },
      catchRate: Number(extractField(baseText, "catchRate")),
      malePercent,
      growthRate: growthRateRaw,
      abilities: { primary: ability1, secondary: ability2, hidden: abilityHidden },
      eggTier: eggTierRaw,
      evolutions: parseEvolutions(block),
    });
  }
  return species;
}

let allSpecies = [];
for (let g = 1; g <= 9; g++) {
  const parsed = parseGenerationFile(g);
  console.error(`  generation-0${g}: ${parsed.length} species`);
  allSpecies = allSpecies.concat(parsed);
}
allSpecies.sort((a, b) => a.id - b.id);

// ---------------------------------------------------------------------------
// Curated held items (hand-picked; PokeRogue's full modifier/economy system is
// out of scope — see DESIGN.md). Numbers below are mainline-canon effects,
// cross-checked against src/modifier/modifier.ts where the fork implements them.
// ---------------------------------------------------------------------------
const items = [
  { id: "choice_band", name: "Choice Band", effect: "1.5x Attack; locks the holder into its first move until it switches out.", category: "choice" },
  { id: "choice_specs", name: "Choice Specs", effect: "1.5x Special Attack; locks the holder into its first move until it switches out.", category: "choice" },
  { id: "choice_scarf", name: "Choice Scarf", effect: "1.5x Speed; locks the holder into its first move until it switches out.", category: "choice" },
  { id: "life_orb", name: "Life Orb", effect: "1.3x damage on attacking moves; holder loses 10% max HP after each hit that deals damage.", category: "damage-boost" },
  { id: "expert_belt", name: "Expert Belt", effect: "1.2x damage when a move is super effective.", category: "damage-boost" },
  { id: "muscle_band", name: "Muscle Band", effect: "1.1x damage on physical moves.", category: "damage-boost" },
  { id: "wise_glasses", name: "Wise Glasses", effect: "1.1x damage on special moves.", category: "damage-boost" },
  { id: "eviolite", name: "Eviolite", effect: "1.5x Defense and Special Defense, if the holder can still evolve.", category: "defense" },
  { id: "assault_vest", name: "Assault Vest", effect: "1.5x Special Defense; holder cannot use status moves.", category: "defense" },
  { id: "leftovers", name: "Leftovers", effect: "Restores 1/16 max HP at the end of each turn.", category: "recovery" },
  { id: "black_sludge", name: "Black Sludge", effect: "Restores 1/16 max HP per turn for Poison types; damages 1/8 max HP per turn for all others.", category: "recovery" },
  { id: "shell_bell", name: "Shell Bell", effect: "Restores 1/8 of the damage the holder deals as HP.", category: "recovery" },
  { id: "focus_sash", name: "Focus Sash", effect: "Survives an otherwise-fatal hit at 1 HP, if at full HP beforehand; consumed on use.", category: "survival" },
  { id: "focus_band", name: "Focus Band", effect: "10% chance to survive an otherwise-fatal hit at 1 HP.", category: "survival" },
  { id: "sitrus_berry", name: "Sitrus Berry", effect: "Restores 25% max HP when HP drops below 50%; consumed on use.", category: "berry" },
  { id: "lum_berry", name: "Lum Berry", effect: "Cures the holder of any status condition or confusion; consumed on use.", category: "berry" },
  { id: "weakness_policy", name: "Weakness Policy", effect: "+2 Attack and Special Attack when hit by a super-effective move; consumed on use.", category: "situational-boost" },
  { id: "rocky_helmet", name: "Rocky Helmet", effect: "Deals 1/6 max HP to any attacker that makes contact with the holder.", category: "retaliation" },
  { id: "type_gem", name: "Type Gem (generic)", effect: "1.5x power on the next move of the matching type; consumed on use. One item per type (Fire Gem, Water Gem, etc.).", category: "one-shot-boost" },
  { id: "type_plate", name: "Type Plate (generic)", effect: "1.2x power on moves of the matching type; also changes Arceus's type. One item per type (Flame Plate, Splash Plate, etc.).", category: "type-boost" },
  { id: "silk_scarf", name: "Silk Scarf", effect: "1.2x power on Normal-type moves.", category: "type-boost" },
  { id: "black_belt", name: "Black Belt", effect: "1.2x power on Fighting-type moves.", category: "type-boost" },
  { id: "charcoal", name: "Charcoal", effect: "1.2x power on Fire-type moves.", category: "type-boost" },
  { id: "mystic_water", name: "Mystic Water", effect: "1.2x power on Water-type moves.", category: "type-boost" },
  { id: "magnet", name: "Magnet", effect: "1.2x power on Electric-type moves.", category: "type-boost" },
  { id: "miracle_seed", name: "Miracle Seed", effect: "1.2x power on Grass-type moves.", category: "type-boost" },
  { id: "never_melt_ice", name: "NeverMeltIce", effect: "1.2x power on Ice-type moves.", category: "type-boost" },
  { id: "scope_lens", name: "Scope Lens", effect: "+1 critical-hit stage.", category: "crit-boost" },
  { id: "razor_claw", name: "Razor Claw", effect: "+1 critical-hit stage.", category: "crit-boost" },
  { id: "king_s_rock", name: "King's Rock", effect: "Adds a 10% flinch chance to moves that don't already flinch.", category: "secondary-effect" },
];

// ---------------------------------------------------------------------------
// Emit TS files
// ---------------------------------------------------------------------------
function tsLiteral(v, indent = 0) {
  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number" && Number.isNaN(v)) return "undefined";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => pad1 + tsLiteral(x, indent + 1)).join(",\n")}\n${pad}]`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, val]) => `${pad1}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${tsLiteral(val, indent + 1)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(v);
}

function writeGenerated(filename, header, body) {
  const full = `${header}\n\n${body}\n`;
  writeFileSync(join(outDir, filename), full);
  console.error(`wrote ${join(outDir, filename)} (${full.length} bytes)`);
}

const GENERATED_NOTE = (what) =>
  `// GENERATED by packages/data/scripts/import-from-pokerogue.mjs — do not hand-edit.\n// Re-run the script against a poke_the_spire checkout to refresh ${what}.`;

writeGenerated(
  "type-chart.generated.ts",
  `${GENERATED_NOTE("the type chart")}\nimport type { PokemonType } from "@pokuelike/engine";\n\n/**\n * The full 18-type effectiveness chart as PokeRogue implements it (attacker type ->\n * defender type -> multiplier), imported for cross-checking against\n * packages/engine/src/typing.ts's hand-maintained copy. See DESIGN.md.\n */`,
  `export const TYPE_CHART: Record<string, Partial<Record<PokemonType, number>>> = ${tsLiteral(
    Object.fromEntries(
      Object.entries(typeChart).map(([atk, defs]) => [
        atk.toLowerCase(),
        Object.fromEntries(Object.entries(defs).map(([def, mult]) => [def.toLowerCase(), mult])),
      ])
    )
  )};\n`
);

writeGenerated(
  "abilities.generated.ts",
  `${GENERATED_NOTE("the ability list")}\n\n/**\n * Reference-only ability data (id/name + the PokeRogue attr-class names it applies,\n * as a lightweight tag list). Ability *effects* are not simulated by the engine —\n * see TODO.md. No plain-text ability descriptions ship in this source tree (they\n * live in a separate i18n locale repo PokeRogue didn't have checked out here), so\n * "description" is intentionally absent; the tag list is the closest at-a-glance\n * summary available without porting each attr's battle logic.\n */\nexport interface AbilityDexEntry {\n  id: number;\n  key: string;\n  name: string;\n  /** PokeRogue AbAttr class names this ability applies — a tag list, not implemented logic. */\n  tags: string[];\n  /** True if the ability is suppressible by Mold Breaker-style effects (PokeRogue's \`.ignorable()\`). */\n  ignorable: boolean;\n}`,
  `export const ABILITY_DEX: AbilityDexEntry[] = ${tsLiteral(abilities)};\n`
);

writeGenerated(
  "moves.generated.ts",
  `${GENERATED_NOTE("the move dex")}\nimport type { PokemonType } from "@pokuelike/engine";\n\n/**\n * Full move dex imported from PokeRogue: core numeric/categorical fields plus a\n * lightweight tag list (attr names + flag methods) capturing what a move does at\n * a glance. This does NOT reimplement move battle logic — see TODO.md and\n * packages/data/src/moves.ts (the small curated set the sim actually uses).\n */\nexport interface MoveDexEntry {\n  id: number;\n  key: string;\n  name: string;\n  type: PokemonType;\n  category: "physical" | "special" | "status";\n  power: number;\n  accuracy: number;\n  pp: number;\n  /** -1 = no secondary effect / chance not applicable. */\n  effectChance: number;\n  priority: number;\n  generation: number;\n  /** PokeRogue MoveTarget enum key, e.g. "NEAR_OTHER", "ALL_NEAR_ENEMIES". */\n  target?: string;\n  /** Flag methods called on the move builder (makesContact/punchingMove/soundBased/...). */\n  flags: string[];\n  /** MoveAttr class names chained via .attr(...) — a tag list, not implemented logic. */\n  tags: string[];\n}`,
  `export const MOVE_DEX: MoveDexEntry[] = ${tsLiteral(moves)};\n\nexport const MOVE_DEX_BY_KEY: Record<string, MoveDexEntry> = Object.fromEntries(\n  MOVE_DEX.map((m) => [m.key, m])\n);\n`
);

writeGenerated(
  "species.generated.ts",
  `${GENERATED_NOTE("the species dex")}\nimport type { PokemonType } from "@pokuelike/engine";\n\n/**\n * Full species dex imported from PokeRogue: base-form stats/types/abilities/\n * catch data + evolutions, for every species across generations 1-9.\n *\n * SCOPE: base forms only. Alternate forms (regional variants, Mega Evolution,\n * Gigantamax, battle forms like Rotom/Necrozma, cosmetic forms) are NOT\n * imported — PokeRogue nests them inside each species' \`forms: [...]\` array\n * with their own copies of every scalar field, and reconciling "which form is\n * canonical" plus form-change triggers was judged out of scope for a data\n * import (see DESIGN.md). A future pass could add a separate forms table\n * keyed by species id.\n */\nexport interface EvolutionDexEntry {\n  /** Target species id (this dex's numbering, same as PokeRogue's SpeciesId). */\n  target: number;\n  targetName: string;\n  /** Minimum level, if level-based. Undefined for item/trade/friendship/etc. evolutions. */\n  level?: number;\n  /** Freeform key->raw-value bag for every other condition PokeRogue attaches (item, timeOfDay, ...) — not parsed further; see DESIGN.md. */\n  conditions: Record<string, string>;\n}\n\nexport interface SpeciesDexEntry {\n  id: number;\n  key: string;\n  name: string;\n  generation: number;\n  types: PokemonType[];\n  baseStats: { hp: number; attack: number; defense: number; spAttack: number; spDefense: number; speed: number };\n  catchRate: number;\n  /** Percent chance of being male, 0-100. null = genderless. */\n  malePercent: number | null;\n  /** PokeRogue GrowthRate enum key, e.g. "MEDIUM_SLOW". */\n  growthRate: string;\n  abilities: { primary?: string; secondary?: string; hidden?: string };\n  /** PokeRogue EggTier enum key, e.g. "COMMON". */\n  eggTier?: string;\n  evolutions: EvolutionDexEntry[];\n}`,
  `export const SPECIES_DEX: SpeciesDexEntry[] = ${tsLiteral(allSpecies)};\n\nexport const SPECIES_DEX_BY_KEY: Record<string, SpeciesDexEntry> = Object.fromEntries(\n  SPECIES_DEX.map((s) => [s.key, s])\n);\n`
);

writeGenerated(
  "items.generated.ts",
  `// Hand-curated (not scraped) — see the script's ITEMS section and DESIGN.md.\n\n/**\n * A curated ~30 classic held items relevant to damage math. PokeRogue's full\n * item/modifier system (shop economy, held-item stacking rules, hundreds of\n * items) is enormous and out of scope — see TODO.md. Not wired into combat.ts.\n */\nexport interface ItemDexEntry {\n  id: string;\n  name: string;\n  effect: string;\n  category: string;\n}`,
  `export const ITEM_DEX: ItemDexEntry[] = ${tsLiteral(items)};\n`
);

console.error("Done.");
