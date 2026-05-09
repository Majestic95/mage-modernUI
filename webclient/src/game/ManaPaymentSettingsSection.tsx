import { useManaPaymentSettings } from './manaPaymentSettings';
import type { GameStream } from './stream';

/**
 * Mana payment — two checkboxes that surface xmage's existing
 * per-player auto-pay preferences. The engine + WebApi already
 * accept the four PlayerAction enums (MANA_AUTO_PAYMENT_{ON,OFF,
 * RESTRICTED_ON,RESTRICTED_OFF}); this UI just dispatches them.
 *
 * <p><b>Auto-pay:</b> when ON, the engine taps your lands
 * automatically when you cast a spell. When OFF (default), you
 * click each land individually.
 *
 * <p><b>Restrict to unambiguous costs:</b> when ON (alongside
 * auto-pay), the engine only auto-taps when there's a unique way
 * to pay — e.g. dual lands offering a color choice will still
 * prompt. Disabled (greyed out) when auto-pay is OFF since the
 * engine ignores the restricted flag in that state.
 *
 * <p>Toggles dispatch via {@code stream.sendPlayerAction(...)}.
 * When {@code stream} is null (mid-disconnect or pre-game), the
 * preference still saves to localStorage but no engine action
 * fires — V0 limitation; a future hook could re-apply on stream
 * connect / game start.
 *
 * <p><b>Why this lives in its own file:</b> SettingsModal.tsx
 * crossed the 500 LOC hard cap when this section was inlined
 * (509 LOC). Extracting the new addition keeps the modal under
 * cap without forcing a broader refactor of all section
 * components in the same slice.
 */
export function ManaPaymentSettingsSection({
  stream,
}: {
  stream: GameStream | null;
}) {
  const autoPay = useManaPaymentSettings((s) => s.autoPay);
  const autoPayRestricted = useManaPaymentSettings((s) => s.autoPayRestricted);
  const setAutoPay = useManaPaymentSettings((s) => s.setAutoPay);
  const setAutoPayRestricted = useManaPaymentSettings(
    (s) => s.setAutoPayRestricted,
  );
  return (
    <section
      data-testid="settings-mana-payment-section"
      className="space-y-2 border-t border-zinc-800 pt-4"
    >
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        Mana payment
      </h3>
      <label className="flex items-start gap-2 text-xs text-text-primary cursor-pointer">
        <input
          type="checkbox"
          data-testid="settings-mana-auto-pay"
          checked={autoPay}
          onChange={(e) => {
            setAutoPay(e.target.checked);
            stream?.sendPlayerAction(
              e.target.checked
                ? 'MANA_AUTO_PAYMENT_ON'
                : 'MANA_AUTO_PAYMENT_OFF',
            );
          }}
          className="h-3.5 w-3.5 mt-0.5 accent-fuchsia-500"
        />
        <span>
          <span className="font-medium">Auto-pay mana</span>
          <span className="block text-text-secondary text-[11px] font-normal mt-0.5">
            Automatically tap your lands to pay mana costs when you
            cast a spell. Off by default — you click each land.
          </span>
        </span>
      </label>
      <label
        className={
          'flex items-start gap-2 text-xs cursor-pointer ' +
          (autoPay
            ? 'text-text-primary'
            : 'text-text-secondary cursor-not-allowed opacity-60')
        }
      >
        <input
          type="checkbox"
          data-testid="settings-mana-auto-pay-restricted"
          checked={autoPayRestricted}
          disabled={!autoPay}
          onChange={(e) => {
            setAutoPayRestricted(e.target.checked);
            stream?.sendPlayerAction(
              e.target.checked
                ? 'MANA_AUTO_PAYMENT_RESTRICTED_ON'
                : 'MANA_AUTO_PAYMENT_RESTRICTED_OFF',
            );
          }}
          className="h-3.5 w-3.5 mt-0.5 accent-fuchsia-500 disabled:cursor-not-allowed"
        />
        <span>
          <span className="font-medium">Restrict to unambiguous costs</span>
          <span className="block text-text-secondary text-[11px] font-normal mt-0.5">
            Only auto-pay when there's a single way to pay — dual
            lands offering a color choice still prompt. Requires
            auto-pay on.
          </span>
        </span>
      </label>
    </section>
  );
}
