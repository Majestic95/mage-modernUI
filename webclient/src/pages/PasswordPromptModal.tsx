import { useRef, useState } from 'react';
import { useModalA11y } from '../util/useModalA11y';

interface Props {
  tableName: string;
  onClose: () => void;
  /**
   * Called with the password the user typed. Caller routes the user
   * into the new lobby with this password threaded through; the lobby
   * supplies it on the first {@code PUT /seat/deck} call. Wrong
   * passwords surface as a 422 from the server when the user picks
   * their first deck — we don't pre-flight on submit because there's
   * no server endpoint that accepts a password without also taking
   * a seat.
   */
  onSubmit: (password: string) => void;
}

/**
 * Slim password gate for joining a passworded table. Deck selection
 * happens inside the new full-page lobby for parity with the host
 * flow — this modal only collects the password and routes onward.
 */
export function PasswordPromptModal({ tableName, onClose, onSubmit }: Props) {
  const [password, setPassword] = useState('');
  const modalRootRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalRootRef, { onClose });

  const submit = () => {
    onSubmit(password);
    onClose();
  };

  return (
    <div
      ref={modalRootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-prompt-heading"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-sm w-full space-y-4">
        <header className="flex items-baseline justify-between">
          <h2 id="password-prompt-heading" className="text-xl font-semibold">
            Password required
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <p className="text-sm text-zinc-400 truncate">{tableName}</p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400 uppercase tracking-wide">
            Password
          </span>
          <input
            type="password"
            data-testid="password-prompt-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            autoFocus
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
            maxLength={64}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="password-prompt-submit"
            onClick={submit}
            className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
