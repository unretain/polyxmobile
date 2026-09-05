import { createContext, useContext } from "react";
import { create } from "zustand";

/**
 * Freezes ONE pulse column while you're interacting with it.
 *
 * New coins land several times a second and are inserted at the TOP, so every arrival
 * shifts every row down. Read a tweet for two seconds and the row under your cursor
 * is a different coin — which at best loses your place and at worst means the
 * instant-buy lightning you were aiming at now belongs to something else.
 *
 * Scoped per column, not globally: hovering New Pairs has no reason to stall Migrated,
 * and freezing all three meant most of the board went stale whenever the pointer
 * happened to rest anywhere over it.
 *
 * Two independent reasons a column holds: the pointer is over its list, or a tweet
 * card opened from one of its rows. The card is portaled to document.body, so moving
 * onto it leaves the column's hover region entirely and would otherwise unfreeze
 * exactly when you started reading — hence it reports which column it belongs to.
 */
export type PulseColumnKey = "new" | "final" | "migrated";

interface PulsePauseState {
  hovered: PulseColumnKey | null;
  cardOpen: PulseColumnKey | null;
  setHovered: (c: PulseColumnKey | null) => void;
  setCardOpen: (c: PulseColumnKey | null) => void;
}

export const usePulsePauseStore = create<PulsePauseState>((set) => ({
  hovered: null,
  cardOpen: null,
  setHovered: (hovered) => set({ hovered }),
  // Only the column that opened a card may clear it; a different column closing its
  // own card must not release someone else's hold.
  setCardOpen: (cardOpen) =>
    set((s) => (cardOpen === null && s.cardOpen === null ? s : { cardOpen })),
}));

/** True while THIS column should hold still. */
export const useColumnPaused = (col: PulseColumnKey) =>
  usePulsePauseStore((s) => s.hovered === col || s.cardOpen === col);

/**
 * Which column a row (and therefore its tweet card) lives in. Null outside a pulse
 * column, so a TweetHover used anywhere else can't pin a column open.
 */
export const PulseColumnContext = createContext<PulseColumnKey | null>(null);
export const usePulseColumn = () => useContext(PulseColumnContext);
