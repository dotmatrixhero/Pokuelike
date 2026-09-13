import type { TileVerb } from "@pokuelike/engine";

/**
 * The radial tile menu.
 *
 * Direct ask: "Long press a tile to open radial, then drag up to one radial
 * section examine it... Another radial section like, let's you target it with
 * an atk. Another let's you gather from that tile."
 *
 * The inversion this implements: the game was verb-first (press `g` to gather,
 * `f` to attack and then pick a target). This is noun-first — touch the tile,
 * and the tile tells you what it offers. Which wedges exist IS the answer to
 * "what can I do here", so it is self-documenting in a way a key list never is:
 * a corpse tile has a Loot wedge and a bare floor does not.
 *
 * **DOM, not canvas.** Wedges are real elements, so they can be styled,
 * hit-tested by the browser, and — the deciding reason — selected by a live
 * Playwright check. This project's standing rule is that a feature is not done
 * until it has been verified in a real browser, and a canvas-drawn radial is
 * far harder to verify honestly.
 *
 * **Press-drag-release, and also click-then-click.** One continuous motion is
 * faster once you know where the wedge is; discrete taps are what you actually
 * do the first few times, and on a trackpad. Supporting only the first would
 * make the menu feel broken to anyone who releases before they mean to.
 *
 * **Two hemispheres.** Direct ask: "THINGS you can do from your current
 * position should be on one section of radial (ex bottom hemisphere), and
 * things you target should be on the other (like top hemisphere)... That way I
 * don't have to precisely target the tile I'm on to drink water when I'm
 * standing on it." So the bottom half is computed from where the player
 * STANDS and is the same whichever tile you press; the top half is about the
 * tile under your finger. The split is the grammar: up means "to that", down
 * means "here".
 *
 * **The centre is Look, not cancel.** Direct ask: "long press into the radial
 * into no swipe always looks, since it's a non destructive action... and tap
 * always moves. Just for consistency?" That makes the two gestures mean one
 * thing each — tap moves, long-press looks — and everything else is a
 * deliberate swipe away. It also means there is nothing to cancel: releasing
 * without choosing costs no turn, because examining never did.
 */

/**
 * One wedge. `id` is an opaque string, not a `TileVerb`, because the same
 * radial now carries three different alphabets: tile verbs on the first ring,
 * and — direct asks, one round — *"the ability to choose the thing to offer
 * also dynamically populating the radial"* and *"select party member that
 * opens second ring of your party"* on the second. Callers that deal in verbs
 * go through `menuItemsFor`, which is still typed.
 */
export interface TileMenuItem {
  id: string;
  label: string;
  icon: string;
  /** Shown in the hub while this wedge is armed — says what committing will do. */
  hint: string;
  /** Marks a wedge that undoes rather than does — cancel, release. Styled apart so it is never picked by accident. */
  destructive?: boolean;
}

/** Order is the wedge order, clockwise from the top. Examine leads because it is free and the thing you want first. */
const VERB_UI: Record<TileVerb, { label: string; icon: string; hint: string }> = {
  examine: { label: "Look", icon: "👁️", hint: "What is here" },
  gather: { label: "Gather", icon: "🌿", hint: "Take what grows here" },
  attack: { label: "Attack", icon: "⚔️", hint: "Pick a move, then strike" },
  command: { label: "Command", icon: "🐾", hint: "Send an ally here" },
  moveHere: { label: "Go", icon: "👣", hint: "Walk to this tile" },
  drink: { label: "Drink", icon: "💧", hint: "Drink from here" },
  eat: { label: "Eat", icon: "🍓", hint: "Eat from the ground" },
  pet: { label: "Pet", icon: "🤚", hint: "Reach out and touch it" },
  offer: { label: "Offer", icon: "🫴", hint: "Put food down for it" },
  loot: { label: "Loot", icon: "🎒", hint: "Take what it carried" },
  butcher: { label: "Butcher", icon: "🔪", hint: "Cut meat and hide" },
  useStairs: { label: "Stairs", icon: "🪜", hint: "Use the stairs" },
};

export function menuItemsFor(verbs: readonly TileVerb[]): TileMenuItem[] {
  return verbs.map((verb) => ({ id: verb, ...VERB_UI[verb] }));
}

/**
 * Radius of the wedge ring in px, and how far from the hub a drag has to
 * travel before a wedge arms. Sized for a thumb: the ring has to clear the
 * hub label and still leave the wedges big enough to hit without looking.
 */
const RADIUS = 104;
const ARM_DISTANCE = 34;

export class TileMenu {
  private readonly root: HTMLElement;
  private readonly hub: HTMLElement;
  private wedges: { el: HTMLElement; item: TileMenuItem; angle: number }[] = [];
  private armed: TileMenuItem | undefined;
  private centre: TileMenuItem | undefined;
  private onPick: ((id: string) => void) | undefined;

  /**
   * `onVisibilityChange` lets the host lock map panning while the menu is up.
   * On touch that is not a nicety: `touch-action: pan-x pan-y` on the map wrap
   * hands the gesture to the browser's own scroller, which swallows the drag
   * and fires `pointercancel` instead of the pointermove/pointerup the menu
   * needs — so on a phone the radial opened and then the map slid away under
   * it. Reported exactly that way: "Radial release on mobile not working it
   * drags the map instead."
   */
  constructor(
    private readonly container: HTMLElement,
    private readonly onVisibilityChange?: (open: boolean) => void
  ) {
    this.root = document.createElement("div");
    this.root.id = "tile-menu";
    this.root.hidden = true;
    this.hub = document.createElement("div");
    this.hub.className = "tile-menu-hub";
    this.root.appendChild(this.hub);
    this.container.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * `at` is in container-relative pixels — where the tile is on screen right
   * now. `centre` is what a release without swiping commits to (Look); it is
   * deliberately NOT also given a wedge, since it is already the default.
   */
  open(
    at: { x: number; y: number },
    targeted: TileMenuItem[],
    self: TileMenuItem[],
    centre: TileMenuItem,
    onPick: (id: string) => void
  ): void {
    // Spread each group across its own half, padded so nothing lands exactly
    // on the horizontal axis where the two halves meet. One item in a half
    // sits dead centre of it — straight up for a target verb, straight down
    // for a "from here" one.
    this.render(at, centre, onPick, [
      ...targeted.map((item, i) => ({ item, angle: -Math.PI + ((i + 1) / (targeted.length + 1)) * Math.PI })),
      ...self.map((item, i) => ({ item, angle: ((i + 1) / (self.length + 1)) * Math.PI })),
    ]);
  }

  /**
   * The second ring: one flat circle of choices, no hemispheres, with the hub
   * as cancel.
   *
   * The hemisphere split on the first ring is a grammar — up means "to that",
   * down means "here". A list of berries or of party members has no such
   * split; every item is the same kind of thing, so forcing them into halves
   * would be a distinction that says nothing. Direct ask on this ring: *"Just
   * make it easy to use and cancel it if needed"* — hence a real Cancel in
   * the hub rather than the first ring's Look, since there is no harmless
   * default to fall back to once you are this deep.
   *
   * Starts at 12 o'clock and goes clockwise, so the first item is always
   * straight up: with two items that is up and down, with four it is the
   * compass points.
   */
  openRing(at: { x: number; y: number }, items: TileMenuItem[], cancel: TileMenuItem, onPick: (id: string) => void): void {
    this.render(
      at,
      cancel,
      onPick,
      items.map((item, i) => ({ item, angle: -Math.PI / 2 + (i / Math.max(1, items.length)) * Math.PI * 2 }))
    );
  }

  private render(
    at: { x: number; y: number },
    centre: TileMenuItem,
    onPick: (id: string) => void,
    placed: { item: TileMenuItem; angle: number }[]
  ): void {
    this.onPick = onPick;
    this.centre = centre;
    this.armed = centre;
    for (const { el } of this.wedges) el.remove();
    this.wedges = [];

    this.root.style.left = `${at.x}px`;
    this.root.style.top = `${at.y}px`;
    this.hub.textContent = centre.hint;
    this.hub.classList.toggle("destructive", centre.destructive === true);

    placed.forEach(({ item, angle }) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "tile-menu-wedge";
      if (item.destructive) el.classList.add("destructive");
      // `data-verb` is the name a live check selects by, and it long predates
      // the id being anything other than a verb. Kept as-is so existing
      // Playwright checks keep working.
      el.dataset.verb = item.id;
      el.style.left = `${Math.cos(angle) * RADIUS}px`;
      el.style.top = `${Math.sin(angle) * RADIUS}px`;
      el.innerHTML = "";
      const icon = document.createElement("span");
      icon.className = "tile-menu-icon";
      icon.textContent = item.icon;
      const label = document.createElement("span");
      label.className = "tile-menu-label";
      label.textContent = item.label;
      el.append(icon, label);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        this.commit(item.id);
      });
      this.root.appendChild(el);
      this.wedges.push({ el, item, angle });
    });

    // Armed from the moment it opens, not only once the pointer first moves:
    // the centre IS the default action, so it has to look like the thing a
    // release would commit before you have done anything.
    this.hub.classList.add("armed");
    this.root.hidden = false;
    this.onVisibilityChange?.(true);
  }

  /**
   * Arms whichever wedge the pointer is nearest, while a drag is in progress.
   * Inside `ARM_DISTANCE` of the hub the CENTRE action is armed — Look — so a
   * long-press you never swiped out of does the harmless, informative thing
   * rather than nothing at all.
   */
  track(pointer: { x: number; y: number }): void {
    if (!this.isOpen) return;
    const rootRect = this.root.getBoundingClientRect();
    const dx = pointer.x - rootRect.left;
    const dy = pointer.y - rootRect.top;
    const distance = Math.hypot(dx, dy);

    let best: TileMenuItem | undefined = this.centre;
    if (distance >= ARM_DISTANCE && this.wedges.length > 0) {
      const angle = Math.atan2(dy, dx);
      let bestDelta = Infinity;
      for (const { item, angle: wedgeAngle } of this.wedges) {
        // Each wedge's own placed angle — the two hemispheres are not evenly
        // spaced around the whole circle, so recomputing from the index would
        // arm the wrong one.
        // Shortest way round the circle, so a wedge at -90° and a pointer at
        // +170° compare correctly.
        const delta = Math.abs(Math.atan2(Math.sin(angle - wedgeAngle), Math.cos(angle - wedgeAngle)));
        if (delta < bestDelta) {
          bestDelta = delta;
          best = item;
        }
      }
    }
    this.armed = best;
    for (const { el, item } of this.wedges) el.classList.toggle("armed", item === best);
    this.hub.classList.toggle("armed", best === this.centre);
    this.hub.textContent = best ? best.hint : "Release to cancel";
  }

  /** Commits whatever is armed. Returns true if something fired. */
  release(): boolean {
    if (!this.isOpen) return false;
    const id = this.armed?.id;
    if (id === undefined) {
      this.close();
      return false;
    }
    this.commit(id);
    return true;
  }

  private commit(id: string): void {
    const onPick = this.onPick;
    this.close();
    onPick?.(id);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.armed = undefined;
    this.centre = undefined;
    this.hub.classList.remove("armed", "destructive");
    this.onPick = undefined;
    this.onVisibilityChange?.(false);
  }
}
