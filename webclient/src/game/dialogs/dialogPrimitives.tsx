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

export function Header({ title }: { title: string }) {
  return (
    <h2 className="text-lg font-semibold text-zinc-100" data-testid="dialog-title">
      {title}
    </h2>
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
