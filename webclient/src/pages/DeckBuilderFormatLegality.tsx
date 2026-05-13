/**
 * Format-picker + legality-pill cluster for DeckBuilderHeader.
 * Extracted from the header during slice DB-1a-fix-6 to keep that
 * file under the 400 LOC soft cap. Behavior preserved verbatim;
 * the only new wire is the `onPillClick` callback that fires when
 * the user clicks a verdict pill carrying at least one issue
 * (header opens the {@link DeckLegalityIssuesModal} in response).
 */
import { Fragment } from 'react';
import type { LegalityStatus } from '../decks/useDeckLegality';
import type { DeckTypeGroup } from '../decks/useDeckTypes';

interface Props {
  deckTypes: DeckTypeGroup[];
  deckTypesLoading: boolean;
  token: string | undefined;
  deckName: string;
  deckType: string;
  onDeckTypeChange: (v: string) => void;
  status: LegalityStatus;
  onPillClick: () => void;
}

export function DeckBuilderFormatLegality({
  deckTypes,
  deckTypesLoading,
  token,
  deckName,
  deckType,
  onDeckTypeChange,
  status,
  onPillClick,
}: Props) {
  return (
    <div
      // backdrop-blur-sm parity with lobby StatusPill so the elevated
      // cluster softens the nebula gradient underneath.
      className="flex flex-col items-center gap-1 rounded-xl border px-5 py-2 backdrop-blur-sm"
      style={{
        background: 'rgba(26, 38, 48, 0.7)',
        borderColor: 'var(--color-card-frame-default)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <select
        data-testid="deck-builder-format-picker"
        value={deckType}
        onChange={(e) => onDeckTypeChange(e.target.value)}
        disabled={deckTypesLoading || !token}
        aria-label={`Format for ${deckName}`}
        className="rounded-md border bg-bg-base px-2 py-1 text-xs text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ borderColor: 'var(--color-card-frame-default)' }}
      >
        <option value="">— pick a format —</option>
        {deckTypes.map((group, i) => (
          <Fragment key={group.label || `flat-${i}`}>
            {group.label ? (
              <optgroup label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.startsWith(`${group.label} - `)
                      ? opt.slice(group.label.length + 3)
                      : opt}
                  </option>
                ))}
              </optgroup>
            ) : (
              <optgroup label="Other">
                {group.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </optgroup>
            )}
          </Fragment>
        ))}
      </select>
      <LegalityPill status={status} onClick={onPillClick} />
    </div>
  );
}

function LegalityPill({
  status,
  onClick,
}: {
  status: LegalityStatus;
  onClick: () => void;
}) {
  if (status.kind === 'idle') {
    return (
      <span
        data-testid="legality-pill-idle"
        className="inline-flex items-center gap-1 text-[11px] font-medium uppercase text-text-muted"
        style={{ letterSpacing: '0.08em' }}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full border border-text-muted"
        />
        Pick a format
      </span>
    );
  }
  const { dotClass, textClass, label } = pillAppearance(status);
  // fix-6 — pill becomes a clickable button when the verdict has
  // errors so the user can pop the issues panel. Loading / error /
  // legal-verdict-with-no-errors stay non-interactive spans (nothing
  // to surface).
  const hasErrors = status.kind === 'verdict' && status.errors.length > 0;
  if (hasErrors) {
    return (
      <button
        type="button"
        data-testid="legality-pill"
        aria-live="polite"
        onClick={onClick}
        title="Click to see what's wrong with the deck"
        className={`inline-flex items-center gap-1 rounded text-[11px] font-medium uppercase transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${textClass}`}
        style={{ letterSpacing: '0.08em' }}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
        {label}
        <ChevronGlyph />
      </button>
    );
  }
  return (
    <span
      data-testid="legality-pill"
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase ${textClass}`}
      style={{ letterSpacing: '0.08em' }}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function ChevronGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="ml-0.5 opacity-70"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function pillAppearance(
  status: Exclude<LegalityStatus, { kind: 'idle' }>,
): { dotClass: string; textClass: string; label: string } {
  if (status.kind === 'loading') {
    return {
      dotClass: 'bg-text-muted',
      textClass: 'text-text-muted italic',
      label: 'Checking…',
    };
  }
  if (status.kind === 'error') {
    return {
      dotClass: 'bg-status-warning',
      textClass: 'text-status-warning',
      label: 'Could not check',
    };
  }
  if (status.valid) {
    return {
      dotClass: 'bg-status-success',
      textClass: 'text-status-success',
      label: 'Legal',
    };
  }
  const realCount = status.errors.filter((e) => !e.synthetic).length;
  const issueWord = realCount === 1 ? 'issue' : 'issues';
  if (status.partlyLegal) {
    return {
      dotClass: 'bg-status-warning',
      textClass: 'text-status-warning',
      label: `Legal once finished · ${realCount} ${issueWord}`,
    };
  }
  return {
    dotClass: 'bg-status-danger',
    textClass: 'text-status-danger',
    label: `Not legal · ${realCount} ${issueWord}`,
  };
}
