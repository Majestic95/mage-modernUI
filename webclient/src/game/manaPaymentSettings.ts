/**
 * Per-user mana-payment settings, persisted to localStorage so the
 * player's auto-pay preferences survive refresh / re-login. Mirrors
 * the {@link useAudioSettings} / {@link useHoverPreviewSettings} /
 * {@link usePriorityStopsSettings} template (zustand store + load /
 * save helpers, same STORAGE_KEY versioning convention).
 *
 * <p>The store only holds the user's stated preference. The actual
 * dispatch to the engine happens at the call site (typically the
 * SettingsModal's onChange handler) via
 * {@code stream.sendPlayerAction('MANA_AUTO_PAYMENT_ON' | '..._OFF'
 * | '..._RESTRICTED_ON' | '..._RESTRICTED_OFF')}. The engine's
 * PlayerAction enums are pre-whitelisted in
 * {@code PlayerActionAllowList.java}; no wire-shape change.
 *
 * <p>Defaults: both OFF. Existing players see no behavior change
 * unless they opt in. xmage's engine default also defaults to
 * manual payment so keeping our store default OFF avoids the
 * "store says auto-pay on, engine isn't auto-paying" disconnect
 * on first connect when no dispatch has fired yet.
 *
 * <p>Known V0 limitation: the dispatch fires only when the user
 * toggles the setting AND a stream is connected. If the engine
 * resets the per-game preference between games, the user must
 * re-toggle. A V1 follow-up could mount a "useApplyManaPayment
 * OnGameStart(stream)" hook that re-dispatches on stream connect.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'xmage.manaPayment.v1';

export interface ManaPaymentSettings {
  /** When true, lands tap automatically when you cast a spell.
   *  Maps to engine PlayerAction.MANA_AUTO_PAYMENT_ON / _OFF. */
  autoPay: boolean;
  /** When true, auto-pay only fires when the cost has a unique
   *  payment (no choice of which lands to tap). Only meaningful
   *  when {@link autoPay} is also true. Maps to engine
   *  PlayerAction.MANA_AUTO_PAYMENT_RESTRICTED_ON / _OFF. */
  autoPayRestricted: boolean;
}

const DEFAULTS: ManaPaymentSettings = {
  autoPay: false,
  autoPayRestricted: false,
};

function load(): ManaPaymentSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ManaPaymentSettings>;
    return {
      autoPay: !!parsed.autoPay,
      autoPayRestricted: !!parsed.autoPayRestricted,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(s: ManaPaymentSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage full / blocked — best-effort, same as audioSettingsStore
  }
}

interface State extends ManaPaymentSettings {
  setAutoPay: (v: boolean) => void;
  setAutoPayRestricted: (v: boolean) => void;
}

export const useManaPaymentSettings = create<State>((set, get) => ({
  ...load(),
  setAutoPay: (v) => {
    set({ autoPay: v });
    save(snapshot(get()));
  },
  setAutoPayRestricted: (v) => {
    set({ autoPayRestricted: v });
    save(snapshot(get()));
  },
}));

function snapshot(s: State): ManaPaymentSettings {
  return {
    autoPay: s.autoPay,
    autoPayRestricted: s.autoPayRestricted,
  };
}
