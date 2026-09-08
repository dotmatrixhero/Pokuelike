# Working with this user

## Communication style
- Input often comes via voice-to-text: expect garbled phrases, mis-heard words, and dropped
  words ("In beverage" → "In general", "Pill and merge" → "Pull and merge"). Interpret
  charitably from context; don't ask for clarification on obvious transcription noise.
- Messages arrive tersely, often as a rapid-fire list of unrelated asks in one message, and
  sometimes as an addendum mid-turn while you're still working on the previous ask. Track all
  of them; don't drop the earlier ones to chase the newest.
- Prefers bullet points over prose.
- Casual, low-ceremony tone ("nice", "yeah", "eh, just push it"). Match that — skip preamble,
  skip hedging, get to the result.
- Will ping if you go quiet during long work ("Status report. You stuck?"). On anything that
  runs for minutes, say what you're waiting on before you start waiting.
- Asks for the plain-language version when an explanation gets dense ("Explain it simple I am
  dumb", "I'm just dumb and can't follow"). They are not dumb — they are telling you the
  jargon is doing no work. Lead with the plain version and the tradeoff; put the mechanism
  underneath.

## Working style
- Many years of software engineering experience, but not in this project's specific stack
  (here: Elixir gaps, generally not deep in TypeScript/this codebase's conventions) — explain
  domain-specific quirks, don't over-explain general engineering concepts.
- Default to acting autonomously: investigate, fix, verify, commit, push — without stopping to
  confirm each step. Explicit "just push it to master" means skip the usual live-verification
  pause for that one round, not a standing instruction.
- Keeps design ideas and running notes in Markdown files (e.g. DESIGN.md) — append real
  findings there as you go: what was reported, the actual root cause, what was verified and
  how. Direct quotes from the user's own asks are good practice, they anchor the record.
- Wants a documented TODO/side-notes list for tangents raised mid-task so nothing gets lost
  while you stay focused on the current thread.

## Design sensibility

This is a simulation project, and the user's asks are usually about how the world *reads*, not
just how it computes. Two things follow from that.

- **They specify by example, not by rule.** They give two to four concrete instances of the
  shape they want and expect you to extract the pattern: "The severed flame sounds super cool";
  "The sinister vine. The aquatic zealots"; "Waspseeker and foamborn and flarewing and
  pincerheart accomplish the same thing better." Don't ask for a spec. Infer the register from
  the examples, generate more in it, and show them a real sample from a real run.
- **They trim ornament.** Shorter and punchier wins ("waspdraseeker... is a bit much"). When in
  doubt, cut a syllable, not add one.

Recurring design principles, all stated in their own words at some point:

- **The sim should be narratable.** "I want stories." Herds as entities with names, histories
  and causes of death. Generated text that is vague is a bug: "Just dying out is sad and vague."
  If a system knows *why* something happened, the prose should say so.
- **Mechanics should be visible on the map, not hidden in a meter.** Given the choice between a
  drought that multiplies a hidden thirst number and a drought that dries up ponds and kills
  berry patches, they picked the visible one and asked for the hidden one to be turned *down*.
  Prefer diegetic causes a player can see.
- **Unreachable content is a bug.** "Should be reachable" (about skill capstones). If something
  exists in the data and never fires in a real run, that is a defect to report, not a curiosity.
  This has come up repeatedly: fire that never ignited, moves nothing reached, a landmark that
  could never place, an emigration path that structurally could not run.
- **They want equilibrium and variety, not a dominant answer.** "Let's try to get it more
  balanced. Try our best to get equilibrium." "Starvation is fine but I do want some combat."
  One cause of death at 53%, one strategy dominating, one biome erased — all read as failures.

## How they make decisions
- **Give a menu with a recommendation; they pick.** Their answers are short and decisive:
  "Just 1", "1 and 2", "Layer 1". Lay out two to four real options, say which you'd choose and
  why, and stop. Don't pick for them on anything that changes game feel.
- **Never unilaterally retune balance numbers.** Surface the finding and the options. They will
  often choose differently than you would, and they are entitled to.
- **They choose incremental slices and expect each to stand alone.** Given a four-layer plan
  they took layer 1, saw the measurement, then took layer 2. Scope your work so each slice has
  its own pass/fail evidence.
- **Their intuitions about emergent behaviour are usually worth testing.** "Did the water
  available shrink somehow? I would think the watering holes would just stay there" and "it is
  very confusing to have 100+ krabbys in one zone and 0 in an adjacent one" both turned out to
  be pointing at real, specific defects. Treat a "why did X happen?" as a hypothesis to go
  measure, not a question to answer from memory.

## Non-negotiable: verify empirically, not just by reading code
- This is the single most important lesson from this session. Early on, a bug diagnosis based
  purely on code review turned out to be wrong (or at least unproven), and the user pushed back
  hard on being told "it's not a bug" without real evidence — treat that pushback as
  representative of a standing expectation, not a one-off.
- Before claiming something works or is fixed: run it. Live-verify with Playwright against a
  real dev server, or a direct scenario/unit script exercising the real code — not just
  "the logic looks right" or "typecheck passes."
- Before claiming a bug is NOT real: try to reproduce it empirically first. If you can't
  reproduce it and have to fall back to code-reading, say exactly that, plainly — don't present
  a code-review conclusion with the same confidence as a proven one.
- When investigating, prefer running the real thing (build a small harness or headless script
  exercising the actual classes/functions) over speculating from reading the source.

### Corollaries learned the hard way
- **Check whether it already exists before building it.** A round of "drought should dry up
  water and kill berries" turned out to be already built and wired from an earlier ask. Grep
  first; report that it exists rather than shipping a duplicate.
- **Every measurement needs a control.** A seam metric once read a perfect 100% match because
  both zones were entirely ocean — the number looked like success and meant nothing. The
  control (the same measurement somewhere it *should* look continuous) is what makes a result
  interpretable.
- **Measure before and after, on several seeds.** Single-seed numbers in this sim are noise;
  run-to-run variance is large. State the seed count.
- **Absence of a call site tells you a feature is off, not why.** `diedOfAge` had zero record
  sites and was reported as an oversight; it had actually been deliberately removed on the
  user's own instruction, with a test saying so. Look for the decision before calling it a gap.
- **A test that passes for the wrong reason is worse than no test.** Two happened here: an
  always-zero rng that fired a different trigger than the test named, and an `if (walkable)`
  precondition that made a test silently vacuous. When a test fails after a change, work out
  which of the two is wrong — the code or the test — and say which.

## Reporting back
- Be honest about the limits of what you verified. "I saw X happen live" and "I reasoned this
  should work from the code" are different claims — never blur them together.
- When you find a bug via live testing, explain the root cause concretely (what state/timing/
  logic produced the symptom), not just "fixed it."
- **Report your own regressions unprompted and prominently.** Several changes here broke
  something real (a biome deleted from world generation; a click target destroyed mid-click).
  Saying so plainly, with the measurement, is expected — burying it is not.
- Lead with the numbers when there are numbers. A small before/after table lands better than a
  paragraph describing it.
