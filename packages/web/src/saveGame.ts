import { EventLog, mulberry32, type SimEvent, type World } from "@pokuelike/engine";
import type { ActionLogEntry } from "./actionLog.js";

/**
 * Autosave for play mode.
 *
 * Direct ask: "sometimes accidentally refreshing and losing everything."
 * `overscroll-behavior` (index.html) stops the *accident*; this stops the
 * *loss*, which is the part that survives a deliberate reload, an iOS tab
 * eviction, or a crash. Before this there was no persistence of any kind —
 * no localStorage, no IndexedDB, nothing — so every run lived only in memory.
 *
 * **Why a state snapshot and not a replay log.** Replaying a recorded action
 * list from the seed would be far smaller, and the engine is deterministic
 * enough to make it tempting. It was rejected: replay cost grows with run
 * length, and any divergence (one unseeded roll anywhere, ever) corrupts the
 * restore *silently*, which is the worst possible failure mode for the one
 * feature whose entire job is not losing your game.
 *
 * **Why gzip.** Measured on a real `createCaveRun`: 6.34 MB of raw JSON
 * across the five levels, which is over localStorage's ~5 MB ceiling. gzip
 * takes that to 0.23 MB (3.7%) — the data is enormously repetitive — so the
 * compressed save fits with room to spare even after base64.
 */

const SAVE_KEY = "pokuelike:run";
/** Bump when the payload shape changes. A mismatch discards the save rather than trying to migrate or, worse, half-reading it. v2 added the action log. */
const SAVE_VERSION = 2;
/**
 * Cap on retained history. The log is the cheapest part of the payload after
 * gzip, but it is also the only part that grows without bound over a long
 * run, so it gets a ceiling while the world (fixed size) does not.
 */
const MAX_SAVED_EVENTS = 5000;
/** Guards the level walk below against a malformed chain looping forever. A real run has five. */
const MAX_LEVELS = 64;

type WorldLinks = World & { below?: World; above?: World };

export interface RunMeta {
  seed: number;
  scenario: "cave" | "surface";
  playerId: string;
}

export interface RestoredRun {
  /** The level the player was actually standing on, already relinked to the rest of the chain. */
  world: World;
  log: EventLog;
  /** Your own history. Saved because a reload wiping it would contradict the ask it was built for: "don't make em expire. Always have em. Stored." */
  actionLog: ActionLogEntry[];
  meta: RunMeta;
  savedAt: number;
}

interface SavePayload {
  version: number;
  savedAt: number;
  meta: RunMeta;
  currentLevel: number;
  levels: Record<string, unknown>[];
  events: SimEvent[];
  actionLog: ActionLogEntry[];
}

/** Every level of a cave run, top-first, regardless of which one the player is currently on. */
function levelChain(world: World): World[] {
  let top = world as WorldLinks;
  for (let guard = 0; top.above && guard < MAX_LEVELS; guard++) top = top.above as WorldLinks;
  const chain: World[] = [];
  for (let cur: WorldLinks | undefined = top; cur && chain.length < MAX_LEVELS; cur = cur.below as WorldLinks | undefined) {
    chain.push(cur);
  }
  return chain;
}

/**
 * One level as plain data. Two things get special handling: the `below`/`above`
 * links (the only cycles in the graph — dropped here and rebuilt on load from
 * array order), and `rng`, which is a live closure. `JSON.stringify` drops
 * functions *silently*, so a naive save would restore a world whose generator
 * had vanished; capturing `state()` instead stores the exact point in the
 * sequence the run had reached.
 */
function toPayload(level: World): Record<string, unknown> {
  const { below: _below, above: _above, rng, ...rest } = level as WorldLinks;
  return { ...rest, __rngState: rng?.state?.() ?? level.rngSeed };
}

function fromPayload(payload: Record<string, unknown>): World {
  const { __rngState, ...rest } = payload;
  const level = rest as unknown as World;
  // Resuming from `rngSeed` rather than the captured state would rewind the
  // generator to worldgen time and hand the player the same "random" numbers
  // a second time — deterministic, but wrong. See rng.test.ts.
  level.rng = mulberry32(typeof __rngState === "number" ? __rngState : level.rngSeed);
  return level;
}

/**
 * `JSON.stringify` turns a `Set` into `{}` — no error, no warning, just an
 * empty object where your data was. `Agent.vision.visible` is a `Set<number>`
 * and `vision.explored` is a record of them per layer, so a save without this
 * restored agents whose vision had quietly become a plain object: the first
 * frame after a reload threw `vision.visible.has is not a function`. Caught
 * live, not by the structural probe, which only sampled the first few agents.
 *
 * Handled generically rather than by reaching into `vision` specifically, so
 * a `Set` or `Map` added anywhere in the graph later does not reintroduce the
 * same silent hole.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return { __set: [...value] };
  if (value instanceof Map) return { __map: [...value] };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object") {
    const tagged = value as { __set?: unknown; __map?: unknown };
    if (Array.isArray(tagged.__set)) return new Set(tagged.__set);
    if (Array.isArray(tagged.__map)) return new Map(tagged.__map as [unknown, unknown][]);
  }
  return value;
}

function toBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) on a few hundred KB blows the
  // argument limit and throws.
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

// Return type pins the buffer as a real ArrayBuffer: the default
// `Uint8Array<ArrayBufferLike>` admits SharedArrayBuffer and so is not a
// valid BlobPart.
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const canCompress = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

async function compress(text: string): Promise<string> {
  if (!canCompress) return `r:${text}`;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return `g:${toBase64(new Uint8Array(buf))}`;
}

async function decompress(stored: string): Promise<string> {
  if (stored.startsWith("r:")) return stored.slice(2);
  if (!stored.startsWith("g:")) throw new Error("unrecognised save encoding");
  if (!canCompress) throw new Error("save is gzipped but this browser has no DecompressionStream");
  const bytes = fromBase64(stored.slice(2));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

/** Cheap synchronous check — for deciding whether to offer "continue" before paying to decompress. */
export function hasSavedRun(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false; // private mode, blocked storage
  }
}

export function clearSavedRun(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing we can do, and failing to clear must never break the game */
  }
}

/**
 * Returns false rather than throwing on any failure — a save that cannot be
 * written (quota, private browsing, a serialization surprise) must never take
 * the running game down with it. The caller decides whether to surface it.
 */
export async function saveRun(world: World, log: EventLog, meta: RunMeta, actionLog: readonly ActionLogEntry[]): Promise<boolean> {
  try {
    const chain = levelChain(world);
    const currentLevel = chain.indexOf(world);
    const payload: SavePayload = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      meta,
      currentLevel: currentLevel < 0 ? 0 : currentLevel,
      levels: chain.map(toPayload),
      events: log.events.slice(-MAX_SAVED_EVENTS),
      actionLog: actionLog.slice(-MAX_SAVED_EVENTS),
    };
    localStorage.setItem(SAVE_KEY, await compress(JSON.stringify(payload, replacer)));
    return true;
  } catch {
    return false;
  }
}

/**
 * `undefined` for "no usable save" in every failure case — absent, wrong
 * version, corrupt, or truncated. A save that cannot be read is discarded
 * outright, because silently restoring half a world would be worse than
 * starting fresh.
 */
export async function loadRun(): Promise<RestoredRun | undefined> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SAVE_KEY);
  } catch {
    return undefined;
  }
  if (!stored) return undefined;

  try {
    const payload = JSON.parse(await decompress(stored), reviver) as SavePayload;
    if (payload.version !== SAVE_VERSION) {
      clearSavedRun();
      return undefined;
    }
    const levels = payload.levels.map(fromPayload);
    if (levels.length === 0) return undefined;
    for (let i = 0; i < levels.length - 1; i++) {
      (levels[i] as WorldLinks).below = levels[i + 1];
      (levels[i + 1] as WorldLinks).above = levels[i];
    }
    const world = levels[Math.min(payload.currentLevel, levels.length - 1)]!;
    if (!world.agents?.some((a) => a.id === payload.meta.playerId)) {
      // The player is not in the level we were told they were on: the save is
      // internally inconsistent, so treat it as corrupt.
      clearSavedRun();
      return undefined;
    }
    const log = new EventLog();
    log.events.push(...(payload.events ?? []));
    return { world, log, actionLog: payload.actionLog ?? [], meta: payload.meta, savedAt: payload.savedAt };
  } catch {
    clearSavedRun();
    return undefined;
  }
}
