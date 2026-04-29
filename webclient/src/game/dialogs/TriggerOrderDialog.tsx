import { useEffect, useState } from 'react';
import type { WebCardView, WebGameClientMessage } from '../../api/schemas';
import {
  Header,
  Message,
  type ContentProps,
} from './dialogPrimitives';

/**
 * Triggered-ability ordering panel — slice 26, ADR 0009. Same wire
 * frame as {@link TargetDialog} ({@code gameTarget}), but the rows
 * carry rule text from each ability's {@code rules[]} array instead
 * of card name + typeLine. Click-to-pick is single-shot: the engine
 * resolves the chosen ability, then re-prompts with the remaining
 * abilities until the queue empties (D9).
 *
 * <p>No skip button — {@code chooseTriggeredAbility} does not surface
 * an optional path. No board click-through either: {@code
 * isBoardClickable} returns false for this mode (clickRouter D7).
 *
 * <p>Slice 27 adds a per-row hamburger button → menu with the five
 * {@code TRIGGER_AUTO_ORDER_*} actions ("always first / last by this
 * specific ability / by rule text", plus "reset all"). Two-step
 * dispatch for the `_FIRST` cases mirrors upstream Swing
 * ({@code GamePanel.handleTriggerOrderPopupMenuEvent} at
 * {@code :3067-3113}): send the action, then send
 * {@code playerResponse{uuid: <abilityId>}} so the engine un-blocks.
 * `_LAST` and `_RESET_ALL` close the dialog and wait for the engine
 * to re-fire with the remaining abilities.
 */
export function OrderTriggersDialog({ dialog, stream, clearDialog }: ContentProps) {
  const data = dialog.data as WebGameClientMessage;
  const abilities = Object.values(data.cardsView1);
  // Track which row's auto-order menu is open; null when none.
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  const submit = (id: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    clearDialog();
  };

  // Slice 27 / 28: substitute {this} client-side before sending,
  // mirroring upstream Swing (GamePanel.java:3074-3076). Engine throws
  // on unsubstituted strings (HumanPlayer.setTriggerAutoOrder at
  // :2843-2845). Prefer slice 28's `sourceLabel` (the real source
  // permanent's name, populated facade-side from
  // AbilityView.getSourceCard().getName()), then fall back to the
  // ability's `name` (which is the literal "Ability" for permanent-
  // sourced AbilityViews — a quirk of upstream AbilityView.java:21),
  // then to the literal "Ability" string. With sourceLabel present
  // the substituted rule matches what HumanPlayer.java:1474-1476
  // recomputes via ability.getRule(sourceObject.getName()), so the
  // recorded auto-order key compares correctly against future
  // triggers. Without sourceLabel the substitution is still safe
  // (no {this} survives), but the recorded key won't match the
  // engine's recomputation and the auto-order entry becomes a dead
  // key — see ADR 0009 D5 / critique E3.
  const substituteThis = (
    ruleText: string,
    sourceLabel: string | undefined,
    abilityName: string,
  ): string =>
    ruleText.replace(/\{this\}/g, sourceLabel || abilityName || 'Ability');

  const fireAutoOrder = (
    action:
      | 'TRIGGER_AUTO_ORDER_ABILITY_FIRST'
      | 'TRIGGER_AUTO_ORDER_ABILITY_LAST'
      | 'TRIGGER_AUTO_ORDER_NAME_FIRST'
      | 'TRIGGER_AUTO_ORDER_NAME_LAST'
      | 'TRIGGER_AUTO_ORDER_RESET_ALL',
    ability: WebCardView,
  ) => {
    setMenuOpenFor(null);
    if (!stream) return;
    if (action === 'TRIGGER_AUTO_ORDER_RESET_ALL') {
      stream.sendPlayerAction('TRIGGER_AUTO_ORDER_RESET_ALL', null);
      clearDialog();
      return;
    }
    const isAbilityKind =
      action === 'TRIGGER_AUTO_ORDER_ABILITY_FIRST' ||
      action === 'TRIGGER_AUTO_ORDER_ABILITY_LAST';
    const data = isAbilityKind
      ? { abilityId: ability.id }
      : {
          ruleText: substituteThis(
            (ability.rules ?? [])[0] ?? '',
            ability.sourceLabel,
            ability.name,
          ),
        };
    stream.sendPlayerAction(action, data);
    const isFirst =
      action === 'TRIGGER_AUTO_ORDER_ABILITY_FIRST' ||
      action === 'TRIGGER_AUTO_ORDER_NAME_FIRST';
    if (isFirst) {
      // Two-step dispatch: send the chosen ability id as the dialog
      // response so the engine un-blocks (Swing pattern at
      // GamePanel.java:3081 / :3090).
      stream.sendPlayerResponse(dialog.messageId, 'uuid', ability.id);
    }
    // For both _FIRST and _LAST, close the dialog. The engine will
    // re-fire with the remaining abilities on the next pump.
    clearDialog();
  };

  return (
    <>
      <Header title="Pick triggered ability" />
      <Message text={data.message || 'Pick the next ability to put on the stack.'} />
      <ul
        className="space-y-1.5 max-h-72 overflow-y-auto"
        data-testid="trigger-order-list"
      >
        {abilities.map((a) => {
          const ruleText = (a.rules ?? []).join(' ').replace(/<[^>]+>/g, '').trim();
          const menuOpen = menuOpenFor === a.id;
          return (
            <li
              key={a.id}
              className="relative flex items-stretch gap-1"
            >
              <button
                type="button"
                data-testid="trigger-order-row"
                data-ability-id={a.id}
                onClick={() => submit(a.id)}
                className="flex-1 text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm leading-snug"
              >
                <div>{ruleText || a.name || '(unlabeled trigger)'}</div>
                {a.sourceLabel && (
                  <div
                    data-testid="trigger-order-source"
                    className="text-[10px] text-zinc-400 italic mt-0.5"
                  >
                    from: {a.sourceLabel}
                  </div>
                )}
              </button>
              <button
                type="button"
                data-testid="trigger-order-menu-button"
                data-ability-id={a.id}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Auto-order options"
                onClick={() => setMenuOpenFor(menuOpen ? null : a.id)}
                className="px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 text-sm"
                title="Auto-order options"
              >
                ⋯
              </button>
              {menuOpen && (
                <TriggerOrderMenu
                  ability={a}
                  onAction={(action) => fireAutoOrder(action, a)}
                  onClose={() => setMenuOpenFor(null)}
                />
              )}
            </li>
          );
        })}
        {abilities.length === 0 && (
          <li className="text-zinc-500 italic text-sm">
            No triggers reported — engine likely auto-resolved.
          </li>
        )}
      </ul>
      {/* Slice 28: Reset-all footer button. Same dispatch as the
          per-row menu item, surfaced at the bottom of the panel for
          discoverability — the per-row menu hides it five clicks
          deep. */}
      {abilities.length > 0 && (
        <div className="pt-2 border-t border-zinc-800">
          <button
            type="button"
            data-testid="trigger-order-reset-all"
            onClick={() => {
              if (!stream) return;
              stream.sendPlayerAction('TRIGGER_AUTO_ORDER_RESET_ALL', null);
              clearDialog();
            }}
            className="text-[10px] text-zinc-500 hover:text-zinc-200 uppercase tracking-wide"
            title="Forget every saved auto-order rule"
          >
            Reset all auto-order settings
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Trigger-order auto-order menu (slice 27 / ADR 0009 D8). Five
 * options matching upstream Swing's right-click menu:
 *
 * <ul>
 *   <li>Always first by this ability — `TRIGGER_AUTO_ORDER_ABILITY_FIRST`</li>
 *   <li>Always last by this ability — `TRIGGER_AUTO_ORDER_ABILITY_LAST`</li>
 *   <li>Always first by rule text — `TRIGGER_AUTO_ORDER_NAME_FIRST`</li>
 *   <li>Always last by rule text — `TRIGGER_AUTO_ORDER_NAME_LAST`</li>
 *   <li>Reset all auto-order — `TRIGGER_AUTO_ORDER_RESET_ALL`</li>
 * </ul>
 *
 * <p>Closes on Esc or outside-click via {@code useEffect} listeners.
 */
function TriggerOrderMenu({
  ability,
  onAction,
  onClose,
}: {
  ability: WebCardView;
  onAction: (
    action:
      | 'TRIGGER_AUTO_ORDER_ABILITY_FIRST'
      | 'TRIGGER_AUTO_ORDER_ABILITY_LAST'
      | 'TRIGGER_AUTO_ORDER_NAME_FIRST'
      | 'TRIGGER_AUTO_ORDER_NAME_LAST'
      | 'TRIGGER_AUTO_ORDER_RESET_ALL',
  ) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        onClose();
      }
    };
    const onClick = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest('[data-testid="trigger-order-menu"]')) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  // Suppress menu when this is a NAME_* candidate but the rule has no
  // useful text — the engine compares stored vs incoming rule text;
  // an empty string would match every future trigger.
  const hasRuleText = (ability.rules ?? []).some((r) => r.trim().length > 0);

  return (
    <div
      data-testid="trigger-order-menu"
      role="menu"
      className="absolute right-0 top-full mt-1 z-50 w-72 bg-zinc-900 border border-zinc-700 rounded shadow-2xl text-xs"
    >
      <button
        type="button"
        role="menuitem"
        data-testid="trigger-order-menu-item"
        data-action="TRIGGER_AUTO_ORDER_ABILITY_FIRST"
        onClick={() => onAction('TRIGGER_AUTO_ORDER_ABILITY_FIRST')}
        className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-zinc-200"
      >
        Always put <em>this ability</em> first on the stack
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="trigger-order-menu-item"
        data-action="TRIGGER_AUTO_ORDER_ABILITY_LAST"
        onClick={() => onAction('TRIGGER_AUTO_ORDER_ABILITY_LAST')}
        className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-zinc-200"
      >
        Always put <em>this ability</em> last on the stack
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="trigger-order-menu-item"
        data-action="TRIGGER_AUTO_ORDER_NAME_FIRST"
        disabled={!hasRuleText}
        onClick={() => onAction('TRIGGER_AUTO_ORDER_NAME_FIRST')}
        className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-zinc-200 disabled:text-zinc-600 disabled:cursor-not-allowed"
      >
        Always put <em>any ability with this rule text</em> first
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="trigger-order-menu-item"
        data-action="TRIGGER_AUTO_ORDER_NAME_LAST"
        disabled={!hasRuleText}
        onClick={() => onAction('TRIGGER_AUTO_ORDER_NAME_LAST')}
        className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-zinc-200 disabled:text-zinc-600 disabled:cursor-not-allowed"
      >
        Always put <em>any ability with this rule text</em> last
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="trigger-order-menu-item"
        data-action="TRIGGER_AUTO_ORDER_RESET_ALL"
        onClick={() => onAction('TRIGGER_AUTO_ORDER_RESET_ALL')}
        className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-zinc-400 border-t border-zinc-800"
      >
        Reset all auto-order settings
      </button>
    </div>
  );
}
