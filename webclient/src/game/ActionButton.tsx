/**
 * Slice 70-M (redesign push, picture-catalog §5.C "TURN + ACTION") —
 * single morphing primary action button replacing the multi-button
 * toolbar in the legacy {@link ActionPanel}.
 *
 * <p><b>Anatomy (per picture-catalog §5.C):</b>
 * <ul>
 *   <li>Top: "TURN N" caption label, --color-text-secondary,
 *       --font-size-caption, all-caps tracking-wide. Number from
 *       {@code gameView.turn}.</li>
 *   <li>Below: large purple action button. Morphing label per the
 *       engine's required action. Background --color-accent-primary
 *       with hover/active variants. Border-radius --radius-md (8px).
 *       Padding ~--space-3 × --space-4. Width: full-width minus the
 *       ellipsis button to the right. Height ~40-44px. Font
 *       semibold body.</li>
 *   <li>Ellipsis (⋯) menu button next to the action button. Click
 *       opens dropdown with multi-pass shortcuts + Concede.</li>
 * </ul>
 *
 * <p><b>Hotkeys (preserved invisible UX from slice 29):</b> F2 / F4 /
 * F6 / F8 / Esc / Ctrl+Z still fire the same actions. Power users
 * never see the menu; new users discover them via the ellipsis.
 *
 * <p><b>Concede placement:</b> picture-catalog §5.C / picture-catalog
 * §1.3 puts Concede in the settings modal (header gear icon). Slice
 * 70-O delivers the settings modal and removes Concede from this
 * menu — the morphing action button + ellipsis are now exclusively
 * priority/skip/undo controls. Destructive actions (Concede, Leave)
 * live behind the gear icon with a confirmation gesture.
 *
 * <p><b>Action morph rules</b> (picture-catalog §5.C "Morph rules"):
 * the LABEL changes per state but the underlying dispatch is uniformly
 * {@code nextPhaseAction(step)} for v1. Per-state action dispatch
 * (e.g. "Confirm Targets" → commit the open dialog, not advance phase)
 * is a polish slice 70-Z item — the morphed label still communicates
 * intent even if the dispatch is a generic phase-advance.
 *
 * <p>Reference: docs/design/picture-catalog.md §5.C, §6.1.
 */
import { useEffect, useState } from 'react';
import type { SkipState } from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { useGameStore } from './store';
import type { GameStream } from './stream';
import { nextPhaseAction, primaryActionFor } from '../pages/actionPanelHelpers';

/**
 * Slice 70-M — multi-pass shortcut menu items. Each maps to an
 * upstream {@code PlayerAction} enum name (whitelisted in
 * {@code PlayerActionAllowList}). Hotkeys mirror the slice 29
 * ActionPanel bindings so power users keep their muscle memory.
 */
interface MenuItem {
  label: string;
  action: string;
  hotkey?: string;
  /** Modifier required for the hotkey (Ctrl/Cmd). */
  ctrl?: boolean;
  /** Optional title text for the menu item button. */
  title?: string;
}

// Slice 70-M critic IMPORTANT-5 fix — menu labels match catalog
// §5.C verbatim. Title-case for menu items per catalog precedent.
const MENU_ITEMS: MenuItem[] = [
  {
    label: 'Pass to Next Turn',
    action: 'PASS_PRIORITY_UNTIL_NEXT_TURN',
    hotkey: 'F4',
    title: 'Pass priority through every remaining phase of this turn',
  },
  {
    label: 'Pass to Your Turn',
    // Bug fix — was PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE which only
    // advances to the next main phase (could be the SAME turn's
    // post-combat main, or the opponent's main during their turn).
    // The label "Pass to Your Turn" semantically means "skip until
    // it's MY turn again" — useful when waiting through an
    // opponent's turn. The correct action is
    // PASS_PRIORITY_UNTIL_MY_NEXT_TURN per the engine's PlayerAction
    // enum (Mage/src/main/java/mage/constants/PlayerAction.java:11).
    //
    // Audit fix 2026-05-03 — hotkey changed F6 → F9 to match the
    // legacy desktop xmage convention (engine's PlayerImpl.
    // sendPlayerAction comment-tags this action as F9). F6 belongs
    // to PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK, which the
    // webclient currently doesn't expose as a menu item; the prior
    // F6 binding silently overrode the skip-stack semantics a
    // returning xmage user would expect.
    action: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
    hotkey: 'F9',
    title: 'Pass priority until your next turn begins',
  },
  {
    label: 'Resolve Stack',
    action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    hotkey: 'F8',
    title: 'Pass through every priority window until the stack empties',
  },
  {
    label: 'Stop Skipping',
    action: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
    hotkey: 'Esc',
    title: 'Cancel any in-progress automation',
  },
  {
    label: 'Undo',
    action: 'UNDO',
    hotkey: 'Ctrl+Z',
    ctrl: true,
    title: 'Take back your last action this priority window',
  },
  // Slice 70-O — Concede relocated to the SettingsModal (header
  // gear icon). Picture-catalog §5.C menu items are exclusively
  // priority/skip/undo actions; §1.3 specifies Concede + Leave
  // both live in the settings modal. Removed from the menu here
  // so there's a single canonical destructive-action surface.
];

/**
 * Schema 1.30 — translate a {@code PASS_PRIORITY_UNTIL_*} menu
 * action to the corresponding {@code WebPlayerView.skipState} enum
 * value. Used to highlight the menu item that's currently armed and
 * to pick the human-readable banner label below.
 *
 * <p>The engine action → boolean → wire-enum chain (verified against
 * {@code PlayerImpl.sendPlayerAction}):
 * <ul>
 *   <li>{@code PASS_PRIORITY_UNTIL_NEXT_TURN} (F4) →
 *     {@code passedTurn} → {@code 'NEXT_TURN'}</li>
 *   <li>{@code PASS_PRIORITY_UNTIL_MY_NEXT_TURN} (F9) →
 *     {@code passedAllTurns} → {@code 'ALL_TURNS'}</li>
 *   <li>{@code PASS_PRIORITY_UNTIL_STACK_RESOLVED} →
 *     {@code passedUntilStackResolved} → {@code 'STACK_RESOLVED'}</li>
 * </ul>
 */
const ACTION_TO_SKIP_STATE: Partial<Record<string, SkipState>> = {
  PASS_PRIORITY_UNTIL_NEXT_TURN: 'NEXT_TURN',
  PASS_PRIORITY_UNTIL_MY_NEXT_TURN: 'ALL_TURNS',
  PASS_PRIORITY_UNTIL_STACK_RESOLVED: 'STACK_RESOLVED',
};

/**
 * Human-readable banner copy per skip mode. The banner explains
 * exactly what the engine is doing on the player's behalf so they
 * can decide whether to keep skipping or cancel.
 */
const SKIP_STATE_LABELS: Record<SkipState, string> = {
  '': '',
  ALL_TURNS: 'Skipping until your next turn',
  NEXT_TURN: 'Skipping to next turn',
  END_OF_TURN: 'Skipping to end of turn',
  NEXT_MAIN: 'Skipping to next main phase',
  STACK_RESOLVED: 'Resolving stack',
  END_STEP_BEFORE_MY_TURN: 'Skipping to end step before your next turn',
};

/**
 * Slice 70-M — derive the morphing label per picture-catalog §5.C.
 * Rules in priority order (first match wins):
 *
 *   1. Pre-game / between-games (no nextPhase available) → "Done"
 *   2. Declare-attackers step → "Declare Attackers"
 *   3. Declare-blockers step → "Declare Blockers"
 *   4. Stack non-empty + my priority → "Pass Priority"
 *   5. End-turn / cleanup steps → "End Turn"
 *   6. Default → "Next Phase"
 *
 * <p>The picture-catalog also calls for "Confirm Targets" / "Pay
 * Mana" labels when a target / mana-cost dialog is open, but that
 * coupling requires reading pendingDialog state which is owned by
 * GameDialog. v1 ships the dialog-independent labels; slice 70-Z
 * polish can wire dialog-aware morph if user feedback wants it.
 */
function deriveActionLabel(
  step: string,
  myPriority: boolean,
  stackEmpty: boolean,
  hasNextPhase: boolean,
): string {
  // Slice 70-M critic IMPORTANT-2/3/4 fix — labels match catalog
  // §5.C verbatim. Catalog wording ("Attack" / "Block" / "End Step")
  // is terser and treats the button as an imperative verb, which
  // also aligns with the rest of the morph rules.
  if (!hasNextPhase) {
    return 'Done';
  }
  if (step === 'DECLARE_ATTACKERS' && myPriority) {
    return 'Attack';
  }
  if (step === 'DECLARE_BLOCKERS' && myPriority) {
    return 'Block';
  }
  if (!stackEmpty && myPriority) {
    return 'Pass Priority';
  }
  if (step === 'END_TURN' || step === 'CLEANUP') {
    return 'End Step';
  }
  // Default fallback — catalog §5.C lists "Done" as the default-
  // default but that reads confusingly mid-main-phase ("done with
  // what?"). "Next Phase" is the carry-over from the legacy
  // ActionPanel and reads as an imperative ("advance the
  // timeline"). Tracked as a catalog-clarification request in the
  // 70-M critic findings (NICE-TO-HAVE, slice 70-Z polish).
  return 'Next Phase';
}

interface Props {
  stream: GameStream | null;
}

export function ActionButton({ stream }: Props) {
  const session = useAuthStore((s) => s.session);
  const gv = useGameStore((s) => s.gameView);
  const [menuOpen, setMenuOpen] = useState(false);

  // Slice 70-M — global hotkey listener mirrors the slice-29 binding
  // verbatim so power users keep their existing muscle memory. Keys
  // captured at the document level so users don't have to focus the
  // panel; suppressed when focus is in an editable element so chat
  // typing doesn't trip the bindings.
  useEffect(() => {
    if (!stream) return;
    const handler = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const ctrlOrCmd = ev.ctrlKey || ev.metaKey;
      // Map ev.key to the menu item; F2 is the primary action.
      if (ev.key === 'F2') {
        const gv2 = useGameStore.getState().gameView;
        const step = gv2?.step ?? '';
        const stackEmpty2 = !gv2 || Object.keys(gv2.stack).length === 0;
        const username = useAuthStore.getState().session?.username;
        const myPriority2 = !!gv2 && gv2.priorityPlayerName === username;
        // Slice 70-Z bug fix — F2 must follow the same dispatch rules
        // as the primary button click so the hotkey doesn't fire the
        // wrong action when stack is non-empty (see primaryActionFor).
        const action = primaryActionFor(step, stackEmpty2, myPriority2);
        if (action) {
          ev.preventDefault();
          stream.sendPlayerAction(action);
        }
        return;
      }
      const match = MENU_ITEMS.find((item) => {
        if (!item.hotkey) return false;
        const hotkey = item.hotkey;
        const isCtrl = !!item.ctrl;
        // Hotkey labels are friendly display names ("Ctrl+Z", "Esc",
        // "F4"). KeyboardEvent.key uses formal names ("z", "Escape",
        // "F4"). Map the labels to actual key values so the match
        // works regardless of label convention.
        const expectedKey =
          hotkey === 'Ctrl+Z'
            ? 'z'
            : hotkey === 'Esc'
              ? 'Escape'
              : hotkey;
        const keyMatches =
          expectedKey.toLowerCase() === ev.key.toLowerCase();
        return keyMatches && isCtrl === ctrlOrCmd;
      });
      if (!match) return;
      ev.preventDefault();
      stream.sendPlayerAction(match.action);
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [stream]);

  // Close menu on Esc OR click outside. The Esc-handler is registered
  // here AFTER the global hotkey handler so when the menu is open,
  // Esc closes the menu (and stopImmediatePropagation prevents the
  // global handler from also firing PASS_PRIORITY_CANCEL_ALL_ACTIONS).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [menuOpen]);

  if (!gv || !session) return null;

  const myPriority = gv.priorityPlayerName === session.username;
  const stackEmpty = Object.keys(gv.stack).length === 0;
  // Schema 1.30 — local player's armed skip mode. Empty string when
  // no skip is active; one of the SkipState enum values otherwise.
  // Used to render the skip-status banner above the morphing button
  // and to highlight the corresponding menu item as armed.
  const mySkipState: SkipState =
    gv.players.find((p) => p.playerId === gv.myPlayerId)?.skipState ?? '';
  const skipBannerLabel = SKIP_STATE_LABELS[mySkipState];

  const cancelSkip = () => {
    if (!stream) return;
    stream.sendPlayerAction('PASS_PRIORITY_CANCEL_ALL_ACTIONS');
  };
  // Slice 70-Z bug fix — `primaryActionFor` returns the action
  // matching what the button label says. When stack is non-empty + my
  // priority, label morphs to "Pass Priority" and the action is
  // PASS_PRIORITY_UNTIL_STACK_RESOLVED (resolves the spell, returns
  // priority to AP); otherwise the action is the existing
  // phase-advance macro from `nextPhaseAction`. Disabled state is
  // still keyed off `nextPhaseAction` because pre-game / between-
  // games has no phase to advance to.
  const nextPhase = nextPhaseAction(gv.step);
  const primaryAction = primaryActionFor(gv.step, stackEmpty, myPriority);
  const label = deriveActionLabel(gv.step, myPriority, stackEmpty, !!nextPhase);

  // Disabled when there's no next-phase action available (pre-game,
  // between games of a sideboard match, etc.). The button visibly
  // dims; cursor: not-allowed; no hover.
  const disabled = !nextPhase || !stream;

  const dispatchPrimary = () => {
    if (!primaryAction || !stream) return;
    stream.sendPlayerAction(primaryAction);
  };

  const dispatchMenuItem = (item: MenuItem) => {
    setMenuOpen(false);
    if (!stream) return;
    // Audit fix 2026-05-03 — clicking an ARMED skip item should
    // CANCEL the skip, not re-arm it. The engine's
    // sendPlayerAction(PASS_PRIORITY_UNTIL_*) calls
    // resetPlayerPassedActions() then sets the boolean, so a
    // re-dispatch is a no-op-then-arm again. Detect armed state
    // and route to PASS_PRIORITY_CANCEL_ALL_ACTIONS instead.
    const itemSkipState = ACTION_TO_SKIP_STATE[item.action];
    const armed =
      itemSkipState !== undefined && itemSkipState === mySkipState;
    if (armed) {
      stream.sendPlayerAction('PASS_PRIORITY_CANCEL_ALL_ACTIONS');
      return;
    }
    stream.sendPlayerAction(item.action);
  };

  return (
    <section
      data-testid="action-button-section"
      aria-label="Turn and action"
      className="border-t border-zinc-800 px-3 py-2 space-y-2"
    >
      {/* Schema 1.30 — skip-status banner. Renders only while the
          local player has an auto-skip mode armed (F4 / F8 / the
          ellipsis menu's Pass-to-Your-Turn / etc.). Pulses to grab
          attention because auto-skipping is disorienting if the
          player forgot they armed it. Click anywhere on the banner
          to fire PASS_PRIORITY_CANCEL_ALL_ACTIONS and stop the
          skip. The whole banner is the cancel button — not a
          buried × — because the user's primary intent on seeing
          this banner is "make it stop". */}
      {mySkipState !== '' && (
        <button
          type="button"
          data-testid="skip-status-banner"
          data-skip-state={mySkipState}
          onClick={cancelSkip}
          aria-label={`${skipBannerLabel}. Click to cancel.`}
          title="Click to cancel auto-skip"
          className={
            'w-full px-3 py-2 rounded-md text-xs font-semibold ' +
            'bg-amber-500/90 hover:bg-amber-400 text-zinc-950 ' +
            'border border-amber-300 shadow-md ' +
            'animate-pulse cursor-pointer transition-colors ' +
            'flex items-center justify-between gap-2'
          }
        >
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">⏩</span>
            <span>{skipBannerLabel}</span>
          </span>
          <span className="text-[10px] opacity-75 font-mono uppercase">
            click / Esc to cancel
          </span>
        </button>
      )}
      {/* TURN N caption per picture-catalog §5.C. */}
      <header
        data-testid="turn-counter"
        className="text-xs uppercase tracking-wide text-text-secondary"
      >
        Turn {gv.turn || '—'}
      </header>

      {/* Button + ellipsis row. Button takes available width; ellipsis
          is fixed-width on the right. */}
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          data-testid="action-button-primary"
          data-action={primaryAction ?? ''}
          aria-label={label}
          onClick={dispatchPrimary}
          disabled={disabled}
          title={
            disabled
              ? 'No action available'
              : `${label} (F2)`
          }
          // Slice 70-M — picture-catalog §5.C button style:
          // background --color-accent-primary, hover/active variants,
          // text --color-text-on-accent, semibold body font, ~40-44px
          // height (py-2.5 ≈ 10px top+bottom + body line-height
          // ≈ 22px = ~42px). Border-radius rounded-md (--radius-md).
          // Subtle scale-on-press (active:scale-[0.97]) for tactile
          // feedback per spec animation note.
          // Slice 70-M critic IMPORTANT-1 fix — disabled state is
          // a tinted version of the SAME accent token, not the
          // fuchsia carry-over from the legacy ActionPanel.
          // tokens.css explicitly notes the violet/fuchsia
          // separation: accent-primary is the End Step button
          // family, fuchsia is the team-active-halo family. Mixing
          // them in the disabled state visually conflates them.
          className={
            'flex-1 px-4 py-2.5 rounded-md text-sm font-semibold ' +
            'transition-[background-color,transform] duration-150 ' +
            'active:scale-[0.97] ' +
            (disabled
              ? 'bg-accent-primary/30 text-text-on-accent/40 cursor-not-allowed'
              : 'bg-accent-primary hover:bg-accent-primary-hover ' +
                'active:bg-accent-primary-active text-text-on-accent ' +
                'cursor-pointer')
          }
        >
          {label}
        </button>
        <div className="relative">
          <button
            type="button"
            data-testid="action-button-ellipsis"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className={
              'h-full px-2 rounded-md transition-colors ' +
              'bg-surface-card hover:bg-surface-card-hover ' +
              'text-text-secondary hover:text-text-primary ' +
              'border border-zinc-800'
            }
            title="More actions (End turn, Skip combat, Undo, Concede…)"
          >
            <span aria-hidden="true" className="block leading-none">
              ⋯
            </span>
          </button>
          {menuOpen && (
            // Slice 70-M critic IMPORTANT-7 fix — menu z-index
            // bumped to z-55 (above the z-50 backdrop introduced
            // below, which itself sits above GameDialog dialogs at
            // z-40). Without the bump, the menu and the
            // GameDialog dock both lived at z-40/z-50 with DOM-
            // order tie-breaks producing inconsistent click-out
            // behavior depending on whether a dialog was open.
            <ul
              data-testid="action-button-menu"
              role="menu"
              aria-label="More actions"
              className={
                'absolute right-0 bottom-full mb-1 z-[55] min-w-[180px] ' +
                'rounded-md border border-zinc-700 bg-bg-elevated ' +
                'shadow-xl py-1'
              }
            >
              {MENU_ITEMS.map((item) => {
                // Schema 1.30 — when this menu item's mapped skip
                // state matches the local player's armed skip,
                // render an "ARMED" affordance + amber background so
                // the user can see what's running and click to
                // cancel without remembering Esc.
                //
                // Audit fix 2026-05-03 — items that map to a skip
                // state get role="menuitemcheckbox" so aria-checked
                // is valid ARIA (plain menuitem doesn't support
                // aria-checked; SR users get no signal). aria-checked
                // is always present on those items ("true" / "false")
                // per the menuitemcheckbox contract.
                const itemSkipState = ACTION_TO_SKIP_STATE[item.action];
                const isCheckable = itemSkipState !== undefined;
                const armed = isCheckable && itemSkipState === mySkipState;
                return (
                  <li key={item.action} role="none">
                    <button
                      type="button"
                      role={isCheckable ? 'menuitemcheckbox' : 'menuitem'}
                      aria-checked={isCheckable ? armed : undefined}
                      data-testid={`action-menu-${item.action}`}
                      data-armed={armed || undefined}
                      onClick={() => dispatchMenuItem(item)}
                      title={armed ? 'Armed — click to cancel' : item.title}
                      className={
                        'w-full text-left px-3 py-1.5 text-xs transition-colors ' +
                        'flex items-center justify-between gap-2 ' +
                        (armed
                          ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                          : 'text-zinc-200 hover:bg-zinc-800')
                      }
                    >
                      <span className="flex items-center gap-1.5">
                        {armed && (
                          <span aria-hidden="true" className="text-[10px]">
                            ●
                          </span>
                        )}
                        <span>{item.label}</span>
                        {armed && (
                          <span className="text-[9px] uppercase tracking-wider text-amber-300/90 font-bold">
                            armed
                          </span>
                        )}
                      </span>
                      {item.hotkey && (
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {item.hotkey}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Backdrop click-out when menu is open. Slice 70-M
              critic IMPORTANT-7 fix — backdrop bumped from z-40
              to z-50 so it sits ABOVE GameDialog dock dialogs
              (z-40) and BELOW the menu itself (z-55). This means
              clicking ANYWHERE except the menu — including a
              GameDialog dock that's currently open — closes the
              menu. The backdrop is invisible (no bg color) so it
              doesn't visually dim the underlying content; it just
              captures clicks. */}
          {menuOpen && (
            <div
              aria-hidden="true"
              data-testid="action-button-menu-backdrop"
              className="fixed inset-0 z-50"
              onClick={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

    </section>
  );
}
