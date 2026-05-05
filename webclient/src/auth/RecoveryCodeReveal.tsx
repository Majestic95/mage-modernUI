import { useState } from 'react';

/**
 * Slice F24.1 (2026-05-04, post-review extract) — one-time recovery-
 * code reveal panel. Shown after a successful register or recover
 * response carries a {@code recoveryCode} field. The user MUST save
 * it off-screen; the server hashes the cleartext and never re-emits
 * it (rotation issues a fresh code in {@code WebRecoverResponse}).
 *
 * <p>Owns the copy-to-clipboard interaction and the "I've saved it"
 * acknowledgment that flips back to sign-in mode. The parent
 * supplies the cleartext code, the context flavor (so the
 * acknowledgement copy reads correctly for register vs recover), and
 * a single {@code onAcknowledge} callback fired after the user
 * confirms.
 */
export interface RecoveryCodeRevealProps {
  code: string;
  context: 'register' | 'recover';
  onAcknowledge: () => void;
}

export function RecoveryCodeReveal({
  code,
  context,
  onAcknowledge,
}: RecoveryCodeRevealProps) {
  const [copyConfirmation, setCopyConfirmation] = useState<string | null>(null);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyConfirmation('Copied to clipboard');
    } catch {
      // Clipboard API failure (insecure context, denied permission).
      // Fall back to selection-based copy by surfacing instructions.
      setCopyConfirmation('Select the code above and copy manually.');
    }
  };

  return (
    <section
      data-testid="recovery-code-panel"
      className="space-y-3 bg-amber-950/30 border border-amber-700/60 rounded p-4"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-amber-200">
          {context === 'register'
            ? 'Save your recovery code'
            : 'Save your new recovery code'}
        </h2>
        <p className="text-xs text-amber-100/80">
          Write this down or save it in a password manager. It is the
          ONLY way to reset your password if you forget it. We will not
          show it again.
        </p>
      </div>
      <code
        data-testid="recovery-code-value"
        className="block text-center text-base font-mono tracking-wider bg-zinc-950 border border-amber-800/50 rounded px-3 py-3 text-amber-100 select-all"
      >
        {code}
      </code>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="text-xs text-amber-200 hover:text-amber-100 underline"
        >
          Copy code
        </button>
        {copyConfirmation && (
          <span role="status" className="text-xs text-emerald-300">
            {copyConfirmation}
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="recovery-code-acknowledge"
        onClick={onAcknowledge}
        className="w-full bg-amber-600 hover:bg-amber-500 text-zinc-950 font-medium rounded px-3 py-2"
      >
        I&apos;ve saved it — continue
      </button>
    </section>
  );
}
