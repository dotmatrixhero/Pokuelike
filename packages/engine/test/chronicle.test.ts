import { describe, expect, it } from "vitest";
import { chronicleFor } from "../src/chronicle.js";
import type { HerdRecord } from "../src/herds.js";
import type { SimEvent } from "../src/events.js";
import type { World } from "../src/types.js";

/**
 * The ending beat specifically. Direct verdict on the version this replaced:
 * "Are we not following what kills them? Just dying out is sad and vague."
 * Every case below is a cause the engine genuinely records — the point of
 * the tests is that the chronicle now READS them.
 */

const POS = { x: 0, y: 0 };

function herd(over: Partial<HerdRecord> = {}): HerdRecord {
  return {
    id: "h1",
    name: "the Bulbasaurs of Thornhollow",
    placeName: "Thornhollow",
    species: "bulbasaur",
    foundedTick: 0,
    foundedAt: POS,
    origin: "founding",
    peakSize: 8,
    lastSeenTick: 1000,
    dissolvedTick: 1000,
    ...over,
  };
}

function worldWith(record: HerdRecord): World {
  return { herds: { [record.id]: record } } as unknown as World;
}

function ending(events: SimEvent[], record = herd()): string {
  const stories = chronicleFor(worldWith(record), events);
  const beat = stories[0]!.beats.find((b) => b.kind === "end");
  expect(beat, "no ending beat").toBeDefined();
  return beat!.text;
}

function killedBy(tick: number, predatorSpecies: string): SimEvent {
  return {
    kind: "killed",
    tick,
    predatorId: `${predatorSpecies}-1`,
    predatorSpecies,
    preyId: `bulbasaur-${tick}`,
    preySpecies: "bulbasaur",
    herdId: "h1",
    pos: POS,
  };
}

function starved(tick: number, cause: "hunger" | "thirst"): SimEvent {
  return { kind: "starved", tick, agentId: `bulbasaur-${tick}`, species: "bulbasaur", pos: POS, cause, herdId: "h1" };
}

function burned(tick: number): SimEvent {
  return { kind: "burned", tick, agentId: `bulbasaur-${tick}`, species: "bulbasaur", pos: POS, herdId: "h1" };
}

function eggLaid(tick: number): SimEvent {
  return { kind: "eggLaid", tick, motherId: "m", fatherId: "f", eggId: `egg-${tick}`, species: "bulbasaur", layer: "surface", pos: POS, herdId: "h1" };
}

function eggHatched(tick: number): SimEvent {
  return { kind: "eggHatched", tick, agentId: `a-${tick}`, species: "bulbasaur", layer: "surface", pos: POS, herdId: "h1" };
}

function eggEaten(tick: number): SimEvent {
  return { kind: "eggEaten", tick, eaterId: "p", eaterSpecies: "spearow", eggId: `egg-${tick}`, eggSpecies: "bulbasaur", layer: "surface", pos: POS, herdId: "h1" };
}

function beatTexts(events: SimEvent[], record = herd()): string[] {
  return chronicleFor(worldWith(record), events)[0]!.beats.map((b) => b.text);
}

describe("a herd raising young", () => {
  // Direct ask: "some of the births — like a few eggs laid or something —
  // should add a log entry."
  it("reports what hatched, not just what was laid", () => {
    const text = beatTexts([eggLaid(100), eggLaid(110), eggLaid(120), eggHatched(300), eggHatched(310)]).join(" ");
    // A herd lays more than it raises — eggs get eaten, and a clutch laid
    // into a full cluster is lost. Reporting only the laying would be true
    // and misleading at once.
    expect(text).toContain("3 eggs laid, 2 of them hatched");
  });

  it("says so plainly when a whole generation failed", () => {
    expect(beatTexts([eggLaid(100), eggLaid(110)]).join(" ")).toContain("not one of them hatched");
  });

  it("does not mention losses that did not happen", () => {
    expect(beatTexts([eggHatched(300), eggHatched(310)]).join(" ")).toContain("2 hatchlings");
  });

  it("tells a raided nest as one beat, not one line per egg", () => {
    const beats = chronicleFor(worldWith(herd()), [eggEaten(400), eggEaten(410), eggEaten(420)])[0]!.beats;
    const nest = beats.filter((b) => b.text.includes("nest"));
    expect(nest).toHaveLength(1);
    expect(nest[0]!.text).toContain("3 eggs were taken");
  });
});

describe("what ended a herd", () => {
  it("names the animal that hunted them, not just 'predators'", () => {
    const text = ending([killedBy(900, "spearow"), killedBy(950, "spearow"), killedBy(990, "spearow")]);
    expect(text).toContain("Spearow");
    expect(text).toContain("Hunted to the last");
  });

  it("tells hunger and thirst apart", () => {
    expect(ending([starved(900, "hunger"), starved(950, "hunger")])).toContain("nothing left to eat");
    expect(ending([starved(900, "thirst"), starved(950, "thirst")])).toContain("thirst");
  });

  it("attributes fire deaths — they are stamped with the victim's herd", () => {
    expect(ending([burned(900), burned(960)])).toContain("Fire took them");
  });

  it("reports the dominant cause, and a second one only when it is a real share", () => {
    // 4 hunted to 3 starved: both belong in the sentence.
    const both = ending([killedBy(900, "spearow"), killedBy(910, "spearow"), killedBy(920, "spearow"), killedBy(930, "spearow"), starved(940, "hunger"), starved(950, "hunger"), starved(960, "hunger")]);
    expect(both).toContain("Hunted to the last");
    expect(both).toContain("nothing left to eat");
    // 4 hunted to 1 starved: the stray death would read as more important
    // than it was, so it is left out.
    const lopsided = ending([killedBy(900, "spearow"), killedBy(910, "spearow"), killedBy(920, "spearow"), killedBy(930, "spearow"), starved(940, "hunger")]);
    expect(lopsided).not.toContain("nothing left to eat");
  });

  it("weighs the final stretch, not the whole run", () => {
    // Mauled early, starved at the end: it is the starving they are
    // remembered for.
    const text = ending([
      killedBy(10, "spearow"), killedBy(20, "spearow"), killedBy(30, "spearow"), killedBy(40, "spearow"), killedBy(50, "spearow"),
      starved(980, "hunger"), starved(995, "hunger"),
    ]);
    expect(text).toContain("nothing left to eat");
    expect(text).not.toContain("Hunted to the last");
  });

  it("does not invent a death for a herd that simply emptied out", () => {
    // A real, non-fatal ending: the last members crossed into another region
    // and were folded into a herd there. Claiming they died would be a lie.
    const text = ending([]);
    expect(text).toContain("without a death to mark it");
  });
});
