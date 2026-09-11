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
 * **The centre is Look, not cancel.** Direct ask: "long press into the radial
 * into no swipe always looks, since it's a non destructive action... and tap
 * always moves. Just for consistency?" That makes the two gestures mean one
 * thing each — tap moves, long-press looks — and everything else is a
 * deliberate swipe away. It also means there is nothing to cancel: releasing
 * without choosing costs no turn, because examining never did.
 */

export interface TileMenuItem {
  verb: TileVerb;
  label: string;
  icon: string;
  /** Shown in the hub while this wedge is armed — says what committing will do. */
  hint: string;
}

/** Order is the wedge order, clockwise from the top. Examine leads because it is free and the thing you want first. */
const VERB_UI: Record<TileVerb, { label: string; icon: string; hint: string }> = {
  examine: { label: "Look", icon: "👁️", hint: "What is here" },
  gather: { label: "Gather", icon: "🌿", hint: "Take what grows here" },
  attack: { label: "Attack", icon: "⚔️", hint: "Pick a move, then strike" },
  command: { label: "Command", icon: "🐾", hint: "Send an ally here" },
  moveHere: { label: "Go", icon: "👣", hint: "Walk to this tile" },
  drink: { label: "Drink", icon: "💧", hint: "Drink from here" },
  loot: { label: "Loot", icon: "🎒", hint: "Take what it carried" },
  butcher: { label: "Butcher", icon: "🔪", hint: "Cut meat and hide" },
  useStairs: { label: "Stairs", icon: "🪜", hint: "Use the stairs" },
};

export function menuItemsFor(verbs: readonly TileVerb[]): TileMenuItem[] {
  return verbs.map((verb) => ({ verb, ...VERB_UI[verb] }));
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
  private wedges: { el: HTMLElement; item: TileMenuItem }[] = [];
  private armed: TileMenuItem | undefined;
  private centre: TileMenuItem | undefined;
  private onPick: ((verb: TileVerb) => void) | undefined;

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
    items: TileMenuItem[],
    centre: TileMenuItem,
    onPick: (verb: TileVerb) => void
  ): void {
    this.onPick = onPick;
    this.centre = centre;
    this.armed = centre;
    for (const { el } of this.wedges) el.remove();
    this.wedges = [];

    this.root.style.left = `${at.x}px`;
    this.root.style.top = `${at.y}px`;
    this.hub.textContent = centre.hint;

    // Evenly spaced around the ring, starting straight up. "Drag up to one
    // radial section" — so the first and most-wanted verb is the one directly
    // under an upward flick.
    items.forEach((item, i) => {
      const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "tile-menu-wedge";
      el.dataset.verb = item.verb;
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
        this.commit(item.verb);
      });
      this.root.appendChild(el);
      this.wedges.push({ el, item });
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
      this.wedges.forEach(({ item }, i) => {
        const wedgeAngle = (i / this.wedges.length) * Math.PI * 2 - Math.PI / 2;
        // Shortest way round the circle, so the wedge at -90° and a pointer at
        // +170° compare correctly.
        const delta = Math.abs(Math.atan2(Math.sin(angle - wedgeAngle), Math.cos(angle - wedgeAngle)));
        if (delta < bestDelta) {
          bestDelta = delta;
          best = item;
        }
      });
    }
    this.armed = best;
    for (const { el, item } of this.wedges) el.classList.toggle("armed", item === best);
    this.hub.classList.toggle("armed", best === this.centre);
    this.hub.textContent = best ? best.hint : "Release to cancel";
  }

  /** Commits whatever is armed. Returns true if something fired. */
  release(): boolean {
    if (!this.isOpen) return false;
    const verb = this.armed?.verb;
    if (!verb) {
      this.close();
      return false;
    }
    this.commit(verb);
    return true;
  }

  private commit(verb: TileVerb): void {
    const onPick = this.onPick;
    this.close();
    onPick?.(verb);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.armed = undefined;
    this.centre = undefined;
    this.hub.classList.remove("armed");
    this.onPick = undefined;
    this.onVisibilityChange?.(false);
  }
}
