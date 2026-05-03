import type { GameStream } from '../stream';
import type {
  PendingDialogAbilityPicker,
  PendingDialogClientMessage,
} from '../store';
import { renderUpstreamMarkup } from './markupRenderer';

export interface ContentProps {
  dialog: PendingDialogClientMessage;
  stream: GameStream | null;
  clearDialog: () => void;
}

export interface AbilityPickerProps {
  dialog: PendingDialogAbilityPicker;
  stream: GameStream | null;
  clearDialog: () => void;
}

/**
 * Slice 70-X.4 — dialog title bar with optional X close affordance
 * at the top-right. Pass {@code onClose} when the dialog has a
 * legitimate dismissal path (engine accepts a skip / cancel response,
 * OR the dialog is informational). Mandatory prompts (mulligan,
 * yes/no question, mandatory target, declare-attackers, etc.) MUST
 * omit {@code onClose} — locally clearing the modal without
 * dispatching the engine response would leave the game stuck waiting.
 *
 * <p>Each per-dialog file owns the decision because the cancel
 * payload differs (TargetDialog sends an all-zeros UUID; ChooseChoice
 * sends an empty string; AbilityPicker sends a sentinel UUID;
 * ManaPay sends boolean false). The X is just a UI mirror of the
 * existing dismiss button each dialog already exposes — same wire
 * dispatch, second affordance.
 */
export function Header({
  title,
  onClose,
}: {
  title: string;
  onClose?: () => void;
}) {
  // The `data-drag-handle` attribute lets the wrapping
  // {@link useDraggable} hook recognise this region as a drag
  // surface (every game-dialog wrapper participates). `cursor-move`
  // + `select-none` give the visual + selection-suppression
  // affordance. Inner buttons (× close) are still clickable —
  // the hook bails on `closest('button, …')` before initiating drag.
  if (!onClose) {
    return (
      <h2
        data-drag-handle
        className="text-lg font-semibold text-zinc-100 cursor-move select-none"
        data-testid="dialog-title"
      >
        {title}
      </h2>
    );
  }
  return (
    <header
      data-drag-handle
      className="flex items-baseline justify-between cursor-move select-none"
    >
      <h2 className="text-lg font-semibold text-zinc-100" data-testid="dialog-title">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        data-testid="dialog-close"
        aria-label="Close"
        className="text-zinc-400 hover:text-zinc-100 text-2xl leading-none -mt-1 px-2 -mr-2 rounded focus:outline-none focus:ring-2 focus:ring-zinc-600"
      >
        ×
      </button>
    </header>
  );
}

export function Message({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="text-sm text-zinc-300" data-testid="dialog-message">
      {renderUpstreamMarkup(text)}
    </p>
  );
}

export function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}

export function PrimaryButton({
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

export function SecondaryButton({
  onClick,
  children,
  'data-testid': testId,
}: {
  onClick: () => void;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
