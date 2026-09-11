# Play-mode UX redesign

Status: **decided, in progress.** The four open questions were answered — see
*Decisions* immediately below. Slices 0–2 are the agreed scope; the radial
(Slice 3) is designed here but deliberately not yet built.

## Decisions

| Question | Answer |
|---|---|
| Play-mode layout | **Its own.** Side panel becomes "You"; observer tabs collapse behind one secondary "World" tab. |
| Radial vs button pad | **Replace on mobile only.** Verbatim: *"Replace but only on mobile I think?"* Desktop keeps the pad — it has keys *and* right-click and no space pressure, so the pad costs nothing there; mobile is where it eats the map. |
| Autosave | **Folded into this work now**, not a later round. Moves into Slice 0. |
| Scope this round | **Slices 0–2** — stop-the-bleeding fixes, the sidebar, the action log. Radial deferred. |

## The ask

Verbatim:

> I need a better ux for play mode. Both a mobile version and a desktop one.
> I want one sidebar with my player status, and my party members at a glance.
> Then expandable.
>
> I need logs and things that are just about me and my party visible. I want
> one place to see like results of look, gather, like actions. This can be in
> said action log.
>
> On Mobile I don't like how hard it is to scroll around the screen, sometimes
> accidentally refreshing and losing everything. Need it to be easier to
> navigate with buttons either easily dismissable or off to the side so it
> doesn't make the ui obscured.
>
> I want a good menu system and easy ways to command and such. Long press on
> mobile, hover and right click on desktop to do stuff. On Mobile should open
> elegant pop up menus, maybe radial, that are easy. Like. Long press a tile to
> open radial, then drag up to one radial section examine it, seeing what items
> are harvestabls, what kind of terrain and what effects standing on it does.
> Another radial section like, let's you target it with an atk. Another let's
> you gather from that tile. Etc.

## The one idea underneath it

Today the game is **verb-first**: press `g` to gather, `f` to attack (which opens
a move picker, which then asks for a tile). You choose what to do, *then* what to
do it to.

The radial inverts that to **noun-first**: touch the tile, and the tile tells you
what you can do to it. The wedges are whatever is actually legal there — a tile
with lichen offers Gather, a tile with a Zubat offers Attack, a corpse offers
Loot and Butcher, a plain floor offers neither.

That inversion is worth more than the prettier input method, for two reasons:

- **It is self-documenting.** You never have to know that `o` is loot. The tile
  with the corpse on it has a Loot wedge; the tile without one does not.
- **It fits the "informed decisions" pillar.** `NARRATIVE_PILLARS.md` /
  `CLAUDE.md`: *"the ability to make decisions is core to gameplay, and being
  informed about what decisions youre making is important."* Examining the tile
  is the same gesture as acting on it, one wedge apart, and examine costs no
  turn. You look before you commit, in one motion.

Everything else in the ask — the sidebar, the action log, the mobile fixes —
follows from wanting that interaction to have somewhere to put its results and
room on screen to happen.

## What is actually there today

Grounded in a read of the real code, not assumed.

| Thing | Where | State |
|---|---|---|
| `targeting` state machine (pick move → tap tile, live AoE preview) | `main.ts:236`, `1026`, `1042` | **Works.** This is verb-first tile targeting — the radial reuses it, does not replace it. |
| `data-act` delegated verb dispatch | `main.ts:1660` | **Works.** A radial wedge can dispatch through the same path as a HUD button. |
| Party at a glance | `#herd-status-panel`, `main.ts:876` | **Exists**, as a floating panel bottom-left, separate from the HUD. |
| Player vitals | `#player-hud`, `main.ts:546` | **Exists**, floating top-right, with a 7-button verb pad. |
| Player-only event log | `eventLogPanel.playerCache` + "My log" chip | **Exists** (built last round). Carries engine `SimEvent`s only. |
| Keyboard-first numbered menus | `numberMenuRows`, `main.ts:716` | **Works.** Reusable for radial wedge shortcuts. |
| Examine **an agent** | `examine()`, `tells.ts:149` | **Exists.** Free, costs no tick. |
| Examine **a tile** | — | **Does not exist.** New work. |
| Action history | — | **Does not exist.** `hudMessageEl` is one line and every message overwrites the last. |
| `overscroll-behavior` | — | **Absent.** Pull-to-refresh is live. |
| Save / persistence | — | **Absent.** No `localStorage`, no `sessionStorage`, no `indexedDB`. |
| `contextmenu` handler | — | **Absent.** Desktop right-click is greenfield. |
| Screen→tile coordinate math | `main.ts:1837`, `1908`, `renderer.ts:2251` | Inlined **three times**. Needs extracting before a fourth caller. |

### Two bugs behind "accidentally refreshing and losing everything"

This is not one problem, it is two stacked, and fixing only the first still loses
runs:

1. **The refresh is reachable.** `#canvas-wrap` pans by native scroll with
   `touch-action: pan-x pan-y` and no `overscroll-behavior`, so dragging the map
   at its top edge chains the overscroll to the document and triggers
   pull-to-refresh.
2. **Nothing survives a refresh.** There is no persistence of any kind. A
   deliberate reload, an iOS tab eviction, or a crash loses the run just as
   completely as the accident does.

`overscroll-behavior: none` is a one-line fix for (1). (2) is a real feature and
is listed as its own question below, because it is a bigger call than a CSS line.

## Workstream 1 — one sidebar

Collapse `#player-hud` (floating, top-right) and `#herd-status-panel` (floating,
bottom-left) into a single panel. Two things that both show party state become
one thing. This is a deletion as much as an addition.

**Desktop.** In play mode the side panel's contents become **You**:

```
┌── YOU ─────────────────┐
│ Human · Lv4 · Depth 2  │   ← always visible
│ HP    ████████░░  34/42│
│ Hunger ██████░░░░      │
│ Thirst ███████░░░      │
│ Energy █████░░░░░      │
├── PARTY (2) ───────────┤   ← collapsible
│ 🐭 Sandshrew  ██████░  │
│    following · content  │
│ 🦇 Zubat      ███░░░░  │
│    hunting · wounded    │
├── LOG ─────────────────┤   ← collapsible, scrolls
│ #412 You gather 3 lichen│
│ #410 Sandshrew hit Zubat│
│ #408 Rock floor. Flint  │
│      here. Nothing else.│
└────────────────────────┘
```

The observer tabs (Inspector / Battle / Chronicle / Events) are spectator
furniture. In play mode they collapse behind one secondary **World** tab —
see open question 1, this is the biggest structural call in the doc.

**Mobile.** The same panel becomes a bottom sheet with three detents, dragged by
a handle:

- **Peek** (~64px) — one row of four thin vitals bars + a party-count badge.
- **Half** (~45vh) — vitals + party roster.
- **Full** (~85vh) — everything including the log.

This is the literal answer to *"buttons either easily dismissable or off to the
side so it doesn't make the ui obscured"*: at Peek the map owns the screen, and
the sheet is one drag from full detail.

## Workstream 2 — the action log

The gap, precisely: `outcomeText()` (`main.ts:586`) is already a good pure
formatter over `PlayerActionOutcome`, exhaustive over the union. Its output goes
to `hudMessageEl` — **one line, overwritten on every single action.** Gather
results, look results, combat notices all land there and are gone next keypress.
Nothing is kept.

So: a new append-only `actionLog`, rendering **two interleaved sources** by tick:

1. **Your action outcomes** — the strings `outcomeText()` already produces.
2. **You-and-your-party `SimEvent`s** — the never-trimmed `playerCache` that
   already exists, widened from "names the player" to "names the player or a
   bonded follower."

**Why two buffers merged at render, not one.** The tempting shortcut is to push
action outcomes into the event log as synthetic `SimEvent`s. Do not: `SimEvent`
is a strict union with **non-defaulted exhaustive switches in three packages**
(`eventText.ts` in web, `format.ts` in runner, and any other formatter) — adding
a kind breaks builds the engine's own typecheck will not catch. `CLAUDE.md`
records this as a repeat offender. Keep action outcomes in their own typed
buffer and merge them at render time by tick.

Prose in the log follows the house rule from `CLAUDE.md` — plain declarative
sentences, name things, at most two, no ornament:

- "You gather 3 lichen."   not   "Gathering complete; 3 lichen acquired besides."
- "Rock floor. Flint here. Nothing else grows."
- "Sandshrew defeated Zubat. She has defended you."

## Workstream 3 — mobile navigation

- `overscroll-behavior: none` on `html, body` and `contain` on `#canvas-wrap`.
  Kills pull-to-refresh. One line, highest value in the document.
- **Stop the camera fighting the player.** `focusCameraOn` runs after *every*
  `playerAct` (`main.ts:1186`). If you deliberately pan away to look at
  something, your next step snaps the view back. Proposal: skip the recenter
  when the player has manually panned recently **and** the player's tile is
  still on screen. The machinery to tell a user pan from a programmatic one
  already exists (`autoCamLastScroll`, `main.ts:2092`).
- **The radial removes buttons rather than adding them.** Of the seven
  `#hud-pad` verbs, five are tile-contextual (drink, look, gather, attack,
  stairs) and move into the radial. Only wait and crouch have no tile, and
  survive as two small persistent buttons. The map gets its screen back.

## Workstream 4 — the tile menu

**Gesture.** Long-press (touch) or right-click (desktop) a tile → radial opens
anchored on it → drag to a wedge (it highlights, and the radial's center names
what it will do) → release to commit. Release in the center cancels. One
continuous motion, no second tap.

Desktop also gets **hover = free examine**: a light tooltip near the cursor with
terrain, harvestables, and standing effects, no click and no turn spent. This is
the "informed decisions" pillar for free — the information is ambient.

**Wedges are contextual**, never more than six, computed by one pure function:

```ts
verbsForTile(world, player, tile): TileVerb[]
```

Pure and side-effect free, so it is **unit-testable without a browser** — which
matters, because "does a corpse tile actually offer Butcher" is exactly the kind
of thing that silently rots.

| Wedge | Shown when | Costs a turn? |
|---|---|---|
| Examine | always | no |
| Move here | walkable and reachable | yes (walks) |
| Gather | tile has harvestables | yes |
| Attack | occupied, or any tile in range | yes — enters existing `targeting` |
| Command | you have a bonded follower in-zone | yes — enters existing `targeting` |
| Loot / Butcher | corpse present | yes |
| Drink | water | yes |
| Stairs | stairs tile | yes |

Attack and Command **enter the existing `targeting` state with the tile
pre-chosen**, reusing the AoE preview built last round rather than duplicating
it.

**New engine-side work: `examineTile`.** A read-only aggregator returning terrain
kind, what is harvestable here, and what standing on it does. The underlying data
exists (flora/crops for harvestables, `applyTerrainEffectAt` for effects); there
is just no function that reads it out for a tile. This is the only genuinely new
non-UI logic in the whole redesign.

**Implementation: DOM, not canvas.** Absolutely positioned in `#map-area`, like
the existing `#pack-menu` / `#command-menu`. Styling and hit-testing are easier,
and Playwright can select real wedges — this project's standing rule is that it
is not done until it is live-verified, and a canvas-drawn radial is far harder to
verify honestly.

### Pushback on the ask, in three places

Taking this literally everywhere would make the game worse. Three places I would
deviate, flagged rather than silently applied:

1. **The radial must not be the only path to common verbs.** A long-press is
   ~400ms before the menu even appears. If gather is your most frequent action,
   routing it through press-wait-drag-release is *slower* than today's `g`. Keep
   a **primary verb on plain tap**: tap an adjacent tile with a harvestable and
   you gather it; tap a far tile and you walk there. Long-press is for when you
   want the full menu or are unsure. Keys keep working untouched on desktop.
2. **The radial should not swallow the Pack.** Craft, equip, eat-a-specific-item
   and offer are inventory-shaped, not tile-shaped. They have no sensible anchor
   tile. Pack stays its own menu; the radial owns tile verbs only. A radial that
   tried to hold everything would be a worse list.
3. **Examine probably wants to be ambient, not only a wedge.** Keep the Examine
   wedge (it dumps full detail to the action log), but *also* show a two-line
   summary in the radial's center the moment it opens, before you drag anywhere.
   You asked to drag to a wedge to see it; showing it immediately is strictly
   more informed and costs nothing.

## Open questions

1. **Does play mode get its own layout, or stay a skin on the observer app?**
   Recommend **its own**: the side panel becomes "You", and Inspector / Battle /
   Chronicle / Events collapse behind one secondary "World" tab. Bigger diff, but
   the current panel is built for watching a simulation, not for being in one.
   The cheaper alternative is adding "You" as a fifth tab and leaving the rest —
   less disruptive, but your status stays one click away instead of always there.

2. **Does the radial replace the `#hud-pad` button row, or coexist with it?**
   Recommend **replace**, keeping only wait and crouch as small persistent
   buttons. That is what unobscures the map. Coexisting is safer but keeps the
   clutter you are complaining about.

3. **Autosave to `localStorage` — in scope now, or a separate round?** Recommend
   **separate round, but soon**: killing pull-to-refresh stops the accident, and
   autosave is the only thing that stops the *loss*. It is a real feature
   (serialize `World` + player, versioned), not a CSS line, so it deserves its
   own slice rather than being smuggled into a UX pass.

4. **Which slice first?** See below — recommend Slice 0 immediately regardless of
   how you answer the rest, because it is tiny and stops active harm.

## Slices

Each stands alone with its own pass/fail evidence, per the house rule.

- **Slice 0 — stop the bleeding.** `overscroll-behavior`, and stop the camera
  snapping back over a deliberate pan. Two small changes, no restructure.
  *Evidence:* live mobile-viewport Playwright run showing an overscroll drag no
  longer fires a navigation, and a manual pan surviving a subsequent step.
- **Slice 1 — the sidebar.** Merge `#player-hud` + `#herd-status-panel` into one
  panel; desktop sections, mobile bottom sheet with three detents.
  *Evidence:* screenshots at 1280px and 390px; the old floating panels gone.
- **Slice 2 — the action log.** `actionLog` buffer, `outcomeText` results
  captured, party events merged in, rendered in the sidebar.
  *Evidence:* a real run where gather and look results are still readable twenty
  actions later.
- **Slice 3 — the tile menu.** Extract screen→tile math, `verbsForTile` +
  `examineTile` with unit tests, then the radial on long-press / right-click,
  plus desktop hover examine.
  *Evidence:* unit tests for verb legality; live Playwright long-press opening a
  radial whose wedges match the tile; a gather driven entirely through it.
- **Slice 4 — retire the button pad** once the radial covers its verbs.

## Side notes / TODO

Parked, not part of this redesign:

- [ ] **Autosave** (question 3). Needs a serialization format and a version
      field. The single highest-value thing not in this doc.
- [ ] `user-scalable=no` on the viewport meta is *not* currently set. Worth
      considering once pinch-zoom on the canvas is the intended gesture —
      browser page-zoom and canvas-zoom currently compete on mobile.
- [ ] Screen→tile math is inlined three times (`main.ts:1837`, `1908`,
      `renderer.ts:2251`). Extract on the way past in Slice 3.
- [ ] `#hud-keys` cheatsheet is hidden entirely under 768px. Once the radial
      lands it is less necessary, but desktop players still need discoverability
      for keys that have no tile.
- [ ] Loot (`o`) and butcher (`p`) are **keyboard-only today — no button at
      all**, so they are effectively undiscoverable and unreachable on mobile.
      The radial fixes this as a side effect. Flagging it because "unreachable
      content is a bug" is a standing pillar here.
