import { create } from "zustand";

/**
 * Freezes the pulse lists while you're interacting with them.
 *
 * New coins land several times a second and are inserted at the TOP, so every arrival
 * shifts every row down. Read a tweet for two seconds and the row under your cursor
 * is a different coin — which at best loses your place and at worst means the
 * instant-buy lightning you were aiming at now belongs to something else.
 *
 * Two independent reasons to hold: the pointer is over a list, or a tweet card is
 * open. The card is portaled to document.body, so moving onto it leaves the list's
 * hover region entirely and would otherwise unfreeze exactly when you started reading.
 */
interface PulsePauseState {
  hoveringList: boolean;
  cardOpen: boolean;
  setHoveringList: (v: boolean) => void;
  setCardOpen: (v: boolean) => void;
}

export const usePulsePauseStore = create<PulsePauseState>((set) => ({
  hoveringList: false,
  cardOpen: false,
  setHoveringList: (hoveringList) => set({ hoveringList }),
  setCardOpen: (cardOpen) => set({ cardOpen }),
}));

/** True while the lists should hold still. */
export const usePulsePaused = () =>
  usePulsePauseStore((s) => s.hoveringList || s.cardOpen);
