import { useEffect, useState } from 'react';
import type { GameStream } from '../game/stream';
import type {
  WebCardView,
  WebGameClientMessage,
  WebGameView,
} from '../api/schemas';
import { deriveInteractionMode } from '../game/interactionMode';
import {
  useGameStore,
  type PendingDialog,
  type PendingDialogAbilityPicker,
  type PendingDialogClientMessage,
} from '../game/store';

interface ResolvedTarget {
  id: string;
  label: string;
  subtitle: string;
}

/**
 * Resolve a target UUID to a friendly display tuple by walking every
 * place in the game view where the engine might be referencing.
 * Falls back to a short-id stub so the modal always has *something*
 * clickable — better to render an opaque ID than to strand the user
 * with an empty modal and a required pick (e.g. end-of-turn discard).
 */
function resolveTarget(id: string, gv: WebGameView | null): ResolvedTarget {
  if (gv) {
    const player = gv.players.find((p) => p.playerId === id);
    if (player) {
      return { id, label: 'Player', subtitle: player.name || '<unknown>' };
    }
    const inMyHand = gv.myHand[id];
    if (inMyHand) {
      return { id, label: inMyHand.name, subtitle: inMyHand.typeLine };
    }
    for (const p of gv.players) {
      const onBattlefield = p.battlefield[id];
      if (onBattlefield) {
        return {
          id,
          label: onBattlefield.card.name,
          subtitle: onBattlefield.card.typeLine,
        };
      }
      const graveCard = p.graveyard[id];
      if (graveCard) {
        return { id, label: graveCard.name, subtitle: 'graveyard' };
      }
      const exileCard = p.exile[id];
      if (exileCard) {
        return { id, label: exileCard.name, subtitle: 'exile' };
      }
      const sideboardCard = p.sideboard[id];
      if (sideboardCard) {
        return { id, label: sideboardCard.name, subtitle: 'sideboard' };
      }
    }
  }
  // Last-ditch: short-id stub. Better than an empty modal.
  return { id, label: 'Target', subtitle: id.slice(0, 8) };
}

interface Props {
  stream: GameStream | null;
}

/**
 * Modal overlay rendered when the store has a {@code pendingDialog}.
 * Per ADR 0007 D6, each dialog method maps to a specific
 * {@code playerResponse.kind} on the inbound side.
 *
 * <p>Slice 7 adds gamePlayXMana / gameChooseChoice / gameChooseAbility
 * — completing the audit-tier-2 dialog set. Two methods remain
 * deferred (gameChoosePile, gameSelectMultiAmount, userRequestDialog)
 * pending richer view DTOs.
 */
export function GameDialog({ stream }: Props) {
  const dialog = useGameStore((s) => s.pendingDialog);
  const clearDialog = useGameStore((s) => s.clearDialog);

  if (!dialog) return null;

  // gameSelect is upstream's "free priority / combat" prompt.
  // Three sub-modes:
  //   * declareAttackers — banner + OK + (optional) All-attack button
  //   * declareBlockers — banner + OK button
  //   * free priority — render nothing; the board is the input surface
  //     (slice 14 / 15 / 16 handle the clicks).
  if (dialog.method === 'gameSelect') {
    const mode = deriveInteractionMode(dialog);
    if (mode.kind === 'declareAttackers' || mode.kind === 'declareBlockers') {
      return (
        <div
          role="dialog"
          aria-modal="false"
          data-testid="game-dialog"
          data-method={dialog.method}
          data-combat-mode={mode.kind}
          className="fixed bottom-4 right-4 z-40 max-w-sm w-full bg-zinc-900 border border-zinc-700 rounded-lg p-5 space-y-3 shadow-2xl"
        >
          <CombatPanel
            dialog={dialog}
            stream={stream}
            clearDialog={clearDialog}
            isAttackers={mode.kind === 'declareAttackers'}
          />
        </div>
      );
    }
    return null;
  }

  // gameTarget renders as a non-blocking side panel — the
  // Battlefield wires click-on-board to dispatch the target
  // response, so the user can pick by clicking either a card/
  // permanent on the board OR a row in the picker. A full-screen
  // backdrop would prevent the board interaction.
  if (dialog.method === 'gameTarget') {
    return (
      <div
        role="dialog"
        aria-modal="false"
        data-testid="game-dialog"
        data-method={dialog.method}
        className="fixed bottom-4 right-4 z-40 max-w-sm w-full bg-zinc-900 border border-zinc-700 rounded-lg p-5 space-y-3 shadow-2xl"
      >
        <DialogContent dialog={dialog} stream={stream} clearDialog={clearDialog} />
      </div>
    );
  }

  // gamePlayMana / gamePlayXMana — slice 21 (B2). The user pays
  // mana by clicking lands / mana sources on the battlefield;
  // slice 16's clickRouter dispatches manaPay-mode clicks via
  // sendObjectClick. A full-screen modal would block those clicks,
  // so render the panel as a non-blocking side strip instead.
  if (dialog.method === 'gamePlayMana' || dialog.method === 'gamePlayXMana') {
    return (
      <div
        role="dialog"
        aria-modal="false"
        data-testid="game-dialog"
        data-method={dialog.method}
        className="fixed bottom-4 right-4 z-40 max-w-sm w-full bg-zinc-900 border border-zinc-700 rounded-lg p-5 space-y-3 shadow-2xl"
      >
        <DialogContent dialog={dialog} stream={stream} clearDialog={clearDialog} />
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="game-dialog"
      data-method={dialog.method}
      className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-lg w-full space-y-4 shadow-2xl">
        <DialogContent dialog={dialog} stream={stream} clearDialog={clearDialog} />
      </div>
    </div>
  );
}

/* ---------- per-method renderers ---------- */

function DialogContent({
  dialog,
  stream,
  clearDialog,
}: {
  dialog: PendingDialog;
  stream: GameStream | null;
  clearDialog: () => void;
}) {
  // gameChooseAbility branches first because its data shape is
  // distinct (WebAbilityPickerView, not WebGameClientMessage). After
  // this branch TypeScript narrows the rest to client-message shape.
  if (dialog.method === 'gameChooseAbility') {
    return (
      <AbilityPickerDialog
        dialog={dialog}
        stream={stream}
        clearDialog={clearDialog}
      />
    );
  }
  switch (dialog.method) {
    case 'gameAsk':
      return <YesNoDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    case 'gamePlayMana':
    case 'gamePlayXMana':
      return (
        <ManaPayPanel
          dialog={dialog}
          stream={stream}
          clearDialog={clearDialog}
          isXMana={dialog.method === 'gamePlayXMana'}
        />
      );
    case 'gameTarget': {
      // Slice 26 / ADR 0009: gameTarget doubles as the trigger-order
      // prompt. Branch when upstream's queryType discriminator is set.
      const data = dialog.data as WebGameClientMessage;
      if (data.options?.isTriggerOrder) {
        return (
          <OrderTriggersDialog
            dialog={dialog}
            stream={stream}
            clearDialog={clearDialog}
          />
        );
      }
      return <TargetDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    }
    case 'gameSelect':
      return <SelectDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    case 'gameSelectAmount':
      // Re-key on messageId so a new dialog re-mounts the component
      // and useState's initializer picks up the new min/max defaults.
      return (
        <AmountDialog
          key={dialog.messageId}
          dialog={dialog}
          stream={stream}
          clearDialog={clearDialog}
        />
      );
    case 'gameChooseChoice':
      return (
        <ChoiceDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />
      );
    case 'gameInformPersonal':
      return <InformDialog dialog={dialog} clearDialog={clearDialog} title="Info" />;
    case 'gameError':
      return <InformDialog dialog={dialog} clearDialog={clearDialog} title="Error" />;
  }
}

function YesNoDialog({ dialog, stream, clearDialog }: ContentProps) {
  const submit = (value: boolean) => {
    stream?.sendPlayerResponse(dialog.messageId, 'boolean', value);
    clearDialog();
  };
  // Slice 17: upstream's options.UI.{left,right}.btn.text overrides
  // the default Yes/No labels. Mulligan loop populates these as
  // "Mulligan" / "Keep"; Proliferate / Time Travel use "Done";
  // any future spell with custom labels is automatic.
  const data = (dialog.data as { options?: { leftBtnText?: string; rightBtnText?: string } });
  const opts = data.options ?? { leftBtnText: '', rightBtnText: '' };
  const yesLabel = opts.leftBtnText && opts.leftBtnText.length > 0
    ? opts.leftBtnText
    : 'Yes';
  const noLabel = opts.rightBtnText && opts.rightBtnText.length > 0
    ? opts.rightBtnText
    : 'No';
  return (
    <>
      <Header title={dialog.method === 'gamePlayMana' ? 'Pay mana?' : 'Question'} />
      <Message text={dialog.data.message} />
      <Buttons>
        <PrimaryButton onClick={() => submit(true)}>{yesLabel}</PrimaryButton>
        <SecondaryButton onClick={() => submit(false)}>{noLabel}</SecondaryButton>
      </Buttons>
    </>
  );
}

function TargetDialog({ dialog, stream, clearDialog }: ContentProps) {
  const cards = Object.values(dialog.data.cardsView1);
  // gameTarget can ask for non-card targets and for cards from
  // sources cardsView1 doesn't include (end-of-turn discard, where
  // the eligible IDs are in targets[] but the actual card detail
  // lives on gameView.myHand). Walk targets[] and resolve each ID
  // against every place we might find display text:
  //   - players[] → "Player <name>"
  //   - myHand    → the WebCardView (card name + typeLine)
  //   - players[].battlefield permanents → permanent's card view
  //   - players[].graveyard / exile / sideboard → those WebCardViews
  // Anything still unresolved renders as a short-id-stamped row so
  // the user can at least click it and move on.
  const targetIds = dialog.data.targets;
  const gv = dialog.data.gameView;
  const resolvedTargets = cards.length > 0
    ? []
    : targetIds.map((id) => resolveTarget(id, gv));

  const submit = (id: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    clearDialog();
  };
  return (
    <>
      <Header title="Choose target" />
      <Message text={dialog.data.message} />
      {cards.length > 0 && (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="target-list">
          {cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => submit(c.id)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                <span className="font-medium">{c.name}</span>{' '}
                <span className="text-zinc-500 text-xs">{c.typeLine}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cards.length === 0 && resolvedTargets.length > 0 && (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="target-list-resolved">
          {resolvedTargets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => submit(t.id)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                <span className="font-medium">{t.label}</span>
                {t.subtitle && (
                  <>
                    {' '}
                    <span className="text-zinc-500 text-xs">{t.subtitle}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cards.length === 0 && resolvedTargets.length === 0 && (
        <p className="text-zinc-500 italic text-sm">
          No legal targets — pick from the battlefield directly.
        </p>
      )}
      {!dialog.data.flag && (
        <Buttons>
          <SecondaryButton
            onClick={() => {
              // gameTarget with flag=false (not required) — server
              // accepts an empty UUID as "skip" per upstream convention.
              stream?.sendPlayerResponse(dialog.messageId, 'uuid',
                '00000000-0000-0000-0000-000000000000');
              clearDialog();
            }}
          >
            Skip
          </SecondaryButton>
        </Buttons>
      )}
    </>
  );
}

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
function OrderTriggersDialog({ dialog, stream, clearDialog }: ContentProps) {
  const data = dialog.data as WebGameClientMessage;
  const abilities = Object.values(data.cardsView1);
  // Track which row's auto-order menu is open; null when none.
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  const submit = (id: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    clearDialog();
  };

  // Slice 27: substitute {this} client-side before sending, mirroring
  // upstream Swing (GamePanel.java:3075). Engine throws on unsubstituted
  // strings (HumanPlayer.setTriggerAutoOrder at :2843-2845). Substitute
  // with the ability view's `name` field — for permanent-sourced
  // triggers that's the literal "Ability" (a quirk of upstream's
  // AbilityView constructor), but the substitution result still
  // satisfies the no-`{this}` invariant and keeps subsequent
  // comparisons stable.
  const substituteThis = (ruleText: string, abilityName: string): string =>
    ruleText.replace(/\{this\}/g, abilityName || 'Ability');

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

function SelectDialog({ dialog, stream, clearDialog }: ContentProps) {
  // gameSelect doesn't carry a cardsView1 — the player picks from the
  // current battlefield via the GameView. Slice B's modal just shows
  // the prompt; click-to-target on the battlefield is a future slice.
  // For now: render a manual UUID input as an escape hatch.
  const [uuid, setUuid] = useState('');
  const submit = () => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', uuid);
    clearDialog();
  };
  const valid = /^[0-9a-f-]{36}$/i.test(uuid);
  return (
    <>
      <Header title="Select" />
      <Message text={dialog.data.message} />
      <p className="text-xs text-zinc-500">
        (Slice B: paste a target UUID. Click-to-target on the
        battlefield ships in the next slice.)
      </p>
      <input
        type="text"
        value={uuid}
        onChange={(e) => setUuid(e.target.value)}
        placeholder="UUID"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 font-mono text-xs"
      />
      <Buttons>
        <PrimaryButton onClick={submit} disabled={!valid}>
          Submit
        </PrimaryButton>
      </Buttons>
    </>
  );
}

function AmountDialog({ dialog, stream, clearDialog }: ContentProps) {
  // The parent re-mounts this component on each new dialog (key=
  // messageId), so useState's initializer is enough — no effect-
  // driven reset needed.
  const [amount, setAmount] = useState(dialog.data.min);
  const submit = () => {
    stream?.sendPlayerResponse(dialog.messageId, 'integer', amount);
    clearDialog();
  };
  const valid = amount >= dialog.data.min && amount <= dialog.data.max;
  return (
    <>
      <Header title="Pick a number" />
      <Message text={dialog.data.message} />
      <div className="flex items-baseline gap-3">
        <input
          type="number"
          min={dialog.data.min}
          max={dialog.data.max}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 w-24"
        />
        <span className="text-xs text-zinc-500">
          [{dialog.data.min}–{dialog.data.max}]
        </span>
      </div>
      <Buttons>
        <PrimaryButton onClick={submit} disabled={!valid}>
          Submit
        </PrimaryButton>
      </Buttons>
    </>
  );
}

function ChoiceDialog({ dialog, stream, clearDialog }: ContentProps) {
  const choice = dialog.data.choice;
  if (!choice) {
    // Defensive: server should always populate choice on
    // gameChooseChoice; if it doesn't, surface a textual fallback so
    // the user isn't stuck on an empty modal.
    return (
      <>
        <Header title="Choose" />
        <Message text={dialog.data.message || '(no choice payload)'} />
        <Buttons>
          <SecondaryButton onClick={clearDialog}>Dismiss</SecondaryButton>
        </Buttons>
      </>
    );
  }
  const submit = (key: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'string', key);
    clearDialog();
  };
  const entries = Object.entries(choice.choices);
  return (
    <>
      <Header title="Choose one" />
      <Message text={choice.message || dialog.data.message} />
      {choice.subMessage && (
        <p className="text-xs text-zinc-500" data-testid="choice-submessage">
          {choice.subMessage}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-zinc-500 italic text-sm">
          No options available.
        </p>
      ) : (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="choice-list">
          {entries.map(([key, label]) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => submit(key)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!choice.required && (
        <Buttons>
          <SecondaryButton
            onClick={() => {
              // Optional choice — send empty string per upstream
              // convention for "skip" on string-kind responses.
              stream?.sendPlayerResponse(dialog.messageId, 'string', '');
              clearDialog();
            }}
          >
            Skip
          </SecondaryButton>
        </Buttons>
      )}
    </>
  );
}

function AbilityPickerDialog({
  dialog,
  stream,
  clearDialog,
}: AbilityPickerProps) {
  const submit = (abilityId: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', abilityId);
    clearDialog();
  };
  const entries = Object.entries(dialog.data.choices);
  return (
    <>
      <Header title="Choose ability" />
      <Message text={dialog.data.message} />
      {entries.length === 0 ? (
        <p className="text-zinc-500 italic text-sm">
          No abilities available.
        </p>
      ) : (
        <ul
          className="space-y-1 max-h-64 overflow-y-auto"
          data-testid="ability-list"
        >
          {entries.map(([abilityId, label]) => (
            <li key={abilityId}>
              <button
                type="button"
                onClick={() => submit(abilityId)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function InformDialog({
  dialog,
  clearDialog,
  title,
}: {
  dialog: PendingDialog;
  clearDialog: () => void;
  title: string;
}) {
  return (
    <>
      <Header title={title} />
      <Message text={dialog.data.message} />
      <Buttons>
        <PrimaryButton onClick={clearDialog}>OK</PrimaryButton>
      </Buttons>
    </>
  );
}

/* ---------- combat panel (slice 20 B1a) ---------- */

/**
 * Combat-step prompt panel. Drives the declare-attackers and
 * declare-blockers loops:
 *
 * <ul>
 *   <li>The user clicks creatures on their battlefield to toggle
 *       them as attackers / blockers — handled by clickRouter
 *       (slice 16) which dispatches via sendObjectClick without
 *       clearing the dialog.</li>
 *   <li>This panel renders the prompt text + an OK button to
 *       commit the current set ({@code playerResponse{boolean:true}})
 *       + an "All attack" button when upstream populated
 *       {@code options.specialButton} (declareAttackers only).</li>
 * </ul>
 *
 * <p>The OK + All-attack buttons read {@code dialog.messageId} from
 * the store at click time (not from a captured closure) to avoid
 * stale-messageId staleness if the engine fires multiple
 * gameSelect frames during the loop.
 */
function CombatPanel({
  dialog,
  stream,
  clearDialog,
  isAttackers,
}: ContentProps & { isAttackers: boolean }) {
  const data = dialog.data as WebGameClientMessage;
  const specialButton = data.options?.specialButton ?? '';

  const commit = (kind: 'boolean' | 'string', value: boolean | string) => {
    // Read the current pendingDialog from the store imperatively in
    // case the engine pushed a fresh gameSelect mid-render and the
    // closure's messageId is stale.
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, kind, value);
    clearDialog();
  };

  return (
    <>
      <Header
        title={isAttackers ? 'Declare attackers' : 'Declare blockers'}
      />
      <Message
        text={
          data.message ||
          (isAttackers
            ? 'Click creatures to attack with, then OK.'
            : 'Click creatures to block with, then OK.')
        }
      />
      <Buttons>
        {isAttackers && specialButton.length > 0 && (
          <SecondaryButton
            onClick={() => commit('string', 'special')}
          >
            {specialButton}
          </SecondaryButton>
        )}
        <PrimaryButton onClick={() => commit('boolean', true)}>
          OK
        </PrimaryButton>
      </Buttons>
    </>
  );
}

/* ---------- mana-pay panel (slice 21 B2) ---------- */

/**
 * Manual-mana-payment panel. Engine fires gamePlayMana when
 * auto-pay can't resolve a cost (hybrid mana, conditional mana, X
 * costs that need explicit player picks). The user pays by
 * clicking mana-producing permanents on the battlefield —
 * slice 16's clickRouter routes those clicks via sendObjectClick
 * during {@code manaPay} mode without clearing the dialog.
 *
 * <p>This panel renders the cost message and a Cancel button that
 * sends {@code playerResponse{boolean:false}} (upstream rolls back
 * any partial payment).
 *
 * <p>For gamePlayXMana the same panel renders, plus a "Done"
 * button to commit the current X value (upstream uses
 * {@code boolean:false} as the finalize signal here too —
 * verified against HumanPlayer's playXMana loop).
 */
function ManaPayPanel({
  dialog,
  stream,
  clearDialog,
  isXMana,
}: ContentProps & { isXMana: boolean }) {
  const send = (value: boolean) => {
    // Read messageId from the store at click time — the engine
    // fires fresh gamePlayMana frames as each mana is paid; the
    // imperative read avoids stale-id staleness.
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, 'boolean', value);
    clearDialog();
  };

  return (
    <>
      <Header title={isXMana ? 'Pay X mana' : 'Pay mana'} />
      <Message text={dialog.data.message} />
      <p className="text-xs text-zinc-500 italic">
        Click a mana source on the battlefield to pay.
      </p>
      <Buttons>
        {isXMana && (
          <PrimaryButton onClick={() => send(false)}>Done</PrimaryButton>
        )}
        <SecondaryButton onClick={() => send(false)}>Cancel</SecondaryButton>
      </Buttons>
    </>
  );
}

/* ---------- shared UI primitives ---------- */

interface ContentProps {
  dialog: PendingDialogClientMessage;
  stream: GameStream | null;
  clearDialog: () => void;
}

interface AbilityPickerProps {
  dialog: PendingDialogAbilityPicker;
  stream: GameStream | null;
  clearDialog: () => void;
}

function Header({ title }: { title: string }) {
  return (
    <h2 className="text-lg font-semibold text-zinc-100" data-testid="dialog-title">
      {title}
    </h2>
  );
}

function Message({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="text-sm text-zinc-300" data-testid="dialog-message">
      {renderUpstreamMarkup(text)}
    </p>
  );
}

/**
 * Render upstream's tiny HTML-flavored markup safely. Engine messages
 * carry {@code <font color=#XXXXXX>card name</font>} for highlights
 * (typically yellow on card names, red on damage) and {@code <br>}
 * for line breaks. Plain React text rendering would surface these as
 * literal markup in the UI.
 *
 * <p>We tokenize via regex and emit React nodes — no
 * {@code dangerouslySetInnerHTML}, so injected scripts or unknown
 * tags never reach the DOM. The font-color regex only accepts a
 * 3-or-6-char hex color, so a malicious upstream payload can't slip
 * arbitrary CSS into the {@code style} attribute.
 *
 * <p>Any tag we don't explicitly handle is stripped (rendered as the
 * empty string) so users never see raw markup. If upstream adds new
 * formatting, extend the parser rather than punting back to plain
 * text.
 */
function renderUpstreamMarkup(text: string): React.ReactNode {
  const tokenRe =
    /<font\s+color=(#[0-9a-fA-F]{3,6})>([\s\S]*?)<\/font>|<br\s*\/?>|<[^>]+>/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[0].toLowerCase().startsWith('<br')) {
      parts.push(<br key={`br-${key++}`} />);
    } else if (match[0].toLowerCase().startsWith('<font')) {
      const color = match[1]!;
      const inner = match[2] ?? '';
      parts.push(
        <span key={`f-${key++}`} style={{ color }}>
          {renderUpstreamMarkup(inner)}
        </span>,
      );
    }
    // Any other tag (the third arm of the regex) is intentionally
    // dropped — strips out unhandled markup without leaking it.
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
