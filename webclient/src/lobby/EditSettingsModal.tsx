/**
 * Slice L3 — host-only edit modal for a table's editable
 * {@link WebMatchOptionsUpdate} subset. Format / mode /
 * winsNeeded are locked at table creation; player count + AI
 * seats are deferred to the existing seat endpoints (POST /ai,
 * DELETE /seat) — see slice L5.
 *
 * <p>Open / close state is owned by the parent {@link NewLobbyScreen}
 * so the rest of the lobby can dim itself behind the modal backdrop
 * without prop-drilling.
 */
import { useEffect, useRef, useState } from 'react';
import { request, ApiError } from '../api/client';
import {
  webTableSchema,
  type WebMatchOptionsUpdate,
  type WebTable,
} from '../api/schemas';
import { useAuthStore } from '../auth/store';

const SKILL_LEVELS = ['BEGINNER', 'CASUAL', 'SERIOUS'] as const;
const MATCH_TIME_LIMITS = [
  'NONE',
  'MIN_5',
  'MIN_10',
  'MIN_15',
  'MIN_25',
  'MIN_40',
  'MIN_60',
  'MIN_90',
  'MIN_120',
] as const;
const MULLIGAN_TYPES = [
  'GAME_DEFAULT',
  'LONDON',
  'SMOOTHED_LONDON',
  'VANCOUVER',
  'PARIS',
  'CANADIAN_HIGHLANDER',
] as const;
const ATTACK_OPTIONS = ['LEFT', 'RIGHT', 'MULTIPLE'] as const;
const RANGES = ['ALL', 'ONE', 'TWO'] as const;

const TIME_LIMIT_LABEL: Record<string, string> = {
  NONE: 'None',
  MIN_5: '5 minutes',
  MIN_10: '10 minutes',
  MIN_15: '15 minutes',
  MIN_25: '25 minutes',
  MIN_40: '40 minutes',
  MIN_60: '60 minutes',
  MIN_90: '90 minutes',
  MIN_120: '120 minutes',
};

const MULLIGAN_LABEL: Record<string, string> = {
  GAME_DEFAULT: 'Game default',
  LONDON: 'London',
  SMOOTHED_LONDON: 'Smoothed London',
  VANCOUVER: 'Vancouver',
  PARIS: 'Paris',
  CANADIAN_HIGHLANDER: 'Canadian Highlander',
};

const ATTACK_OPTION_LABEL: Record<string, string> = {
  LEFT: 'Left',
  RIGHT: 'Right',
  MULTIPLE: 'Multiple',
};

const RANGE_LABEL: Record<string, string> = {
  ALL: 'All',
  ONE: 'One',
  TWO: 'Two',
};

interface InitialValues {
  password: string;
  skillLevel: string;
  matchTimeLimit: string;
  freeMulligans: number;
  mulliganType: string;
  spectatorsAllowed: boolean;
  rated: boolean;
  attackOption: string;
  range: string;
}

interface Props {
  /** Room UUID — only relevant for the live PATCH path. */
  roomId: string | null;
  /** Table UUID. {@code 'fixture'} disables Save (UI-only preview). */
  tableId: string;
  initial: InitialValues;
  onClose: () => void;
  /**
   * Called with the freshly-mapped {@link WebTable} from the server's
   * PATCH response. Parent uses it to refresh local state without
   * waiting for the next poll.
   */
  onSaved?: (table: WebTable) => void;
}

export function EditSettingsModal({
  roomId,
  tableId,
  initial,
  onClose,
  onSaved,
}: Props) {
  const session = useAuthStore((s) => s.session);
  const [values, setValues] = useState<InitialValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Slice L6 polish — Esc closes the modal; first input gets focus
  // on mount so the user lands somewhere actionable.
  // Slice L8 review (UX MEDIUM #20) — when there are unsaved changes,
  // confirm before discarding via Esc. Submit button click fires the
  // wire path; Cancel and Esc both go through this handler.
  const tryClose = () => {
    const dirty = Object.keys(diff(initial, values)).length > 0;
    if (dirty) {
      const ok = window.confirm(
        'Discard unsaved settings changes?',
      );
      if (!ok) return;
    }
    onClose();
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        tryClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    firstFieldRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
    // tryClose closes over current `initial`/`values`; binding via
    // window listener means we re-attach when those change so Esc
    // sees the latest diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, values, onClose]);

  const isFixture = tableId === 'fixture' || roomId === null;

  const handleSave = async () => {
    if (isFixture) {
      // Fixture path — no PATCH call, just close. Visual review only.
      onClose();
      return;
    }
    if (!session) {
      setError('Session expired — please reload.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const body = diff(initial, values);
    try {
      const updated = await request(
        `/api/rooms/${roomId}/tables/${tableId}`,
        webTableSchema,
        { method: 'PATCH', body, token: session.token },
      );
      onSaved?.(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="edit-settings-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--color-bg-overlay)' }}
      // Same defensive guard as PreLobbyModal — only DIRECT clicks on
      // the backdrop close. Stops native form-control events (number
      // spinners, select dropdowns) from accidentally bubbling past
      // the content's stopPropagation in some browsers and triggering
      // a close.
      onClick={(e) => {
        if (e.target === e.currentTarget) tryClose();
      }}
      role="presentation"
    >
      <div
        data-testid="edit-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit lobby settings"
        className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-xl border p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          boxShadow: 'var(--shadow-high)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2
            className="text-base font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
          >
            Edit Settings
          </h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="edit-settings-close"
            onClick={tryClose}
            className="text-text-secondary transition-colors hover:text-text-primary"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Password">
            <input
              ref={firstFieldRef}
              type="text"
              data-testid="edit-settings-password"
              value={values.password}
              onChange={(e) => setValues({ ...values, password: e.target.value })}
              placeholder="Empty for public"
              className={inputClass()}
            />
          </Field>

          <Field label="Skill level">
            <Select
              data-testid="edit-settings-skill"
              value={values.skillLevel}
              onChange={(v) => setValues({ ...values, skillLevel: v })}
              options={SKILL_LEVELS}
              labelMap={titleCaseMap(SKILL_LEVELS)}
            />
          </Field>

          <Field label="Match time limit">
            <Select
              data-testid="edit-settings-time-limit"
              value={values.matchTimeLimit}
              onChange={(v) => setValues({ ...values, matchTimeLimit: v })}
              options={MATCH_TIME_LIMITS}
              labelMap={TIME_LIMIT_LABEL}
            />
          </Field>

          <Field label="Free mulligans (0–5)">
            <input
              type="number"
              min={0}
              max={5}
              data-testid="edit-settings-free-mulligans"
              value={values.freeMulligans}
              onChange={(e) =>
                setValues({
                  ...values,
                  freeMulligans: clampInt(e.target.value, 0, 5),
                })
              }
              className={inputClass()}
            />
          </Field>

          <Field label="Mulligan type">
            <Select
              data-testid="edit-settings-mulligan-type"
              value={values.mulliganType}
              onChange={(v) => setValues({ ...values, mulliganType: v })}
              options={MULLIGAN_TYPES}
              labelMap={MULLIGAN_LABEL}
            />
          </Field>

          <Field label="Range of influence">
            <Select
              data-testid="edit-settings-range"
              value={values.range}
              onChange={(v) => setValues({ ...values, range: v })}
              options={RANGES}
              labelMap={RANGE_LABEL}
            />
          </Field>

          <Field label="Attack option">
            <Select
              data-testid="edit-settings-attack-option"
              value={values.attackOption}
              onChange={(v) => setValues({ ...values, attackOption: v })}
              options={ATTACK_OPTIONS}
              labelMap={ATTACK_OPTION_LABEL}
            />
          </Field>

          <Field label="Other">
            <div className="flex flex-col gap-2 pt-1">
              <Toggle
                testId="edit-settings-spectators"
                label="Spectators allowed"
                checked={values.spectatorsAllowed}
                onChange={(b) =>
                  setValues({ ...values, spectatorsAllowed: b })
                }
              />
              <Toggle
                testId="edit-settings-rated"
                label="Rated match"
                checked={values.rated}
                onChange={(b) => setValues({ ...values, rated: b })}
              />
            </div>
          </Field>
        </div>

        {error && (
          <p
            data-testid="edit-settings-error"
            className="text-sm text-status-danger"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="edit-settings-cancel"
            onClick={tryClose}
            className="rounded-md border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="edit-settings-save"
            onClick={() => void handleSave()}
            disabled={submitting}
            className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-on-accent transition-colors hover:bg-accent-primary-hover disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-xs uppercase text-text-secondary"
        style={{ letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  labelMap,
  ...rest
}: {
  value: string;
  onChange: (v: T) => void;
  options: readonly T[];
  labelMap: Record<string, string>;
  'data-testid'?: string;
}) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={inputClass()}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {labelMap[opt] ?? opt}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-card-frame-default/80 accent-accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function inputClass(): string {
  // Slice L6 polish — explicit border + bg + focus-ring tokens so
  // native form controls don't fall back to OS chrome on dark mode.
  return 'rounded-md border border-card-frame-default/80 bg-surface-card px-3 py-2 text-sm text-text-primary outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-focus-ring';
}

function clampInt(raw: string, min: number, max: number): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function titleCaseMap(values: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) {
    out[v] = v.charAt(0) + v.slice(1).toLowerCase();
  }
  return out;
}

/**
 * Slice L3 — produce a sparse PATCH body containing only the fields
 * that actually changed. Sending the full diff would still work
 * (server treats every field as optional), but the sparse body keeps
 * server logs noise-free and reduces risk of unintended writes.
 */
function diff(
  before: InitialValues,
  after: InitialValues,
): WebMatchOptionsUpdate {
  const out: WebMatchOptionsUpdate = {};
  if (before.password !== after.password) out.password = after.password;
  if (before.skillLevel !== after.skillLevel) out.skillLevel = after.skillLevel;
  if (before.matchTimeLimit !== after.matchTimeLimit) {
    out.matchTimeLimit = after.matchTimeLimit;
  }
  if (before.freeMulligans !== after.freeMulligans) {
    out.freeMulligans = after.freeMulligans;
  }
  if (before.mulliganType !== after.mulliganType) {
    out.mulliganType = after.mulliganType;
  }
  if (before.spectatorsAllowed !== after.spectatorsAllowed) {
    out.spectatorsAllowed = after.spectatorsAllowed;
  }
  if (before.rated !== after.rated) out.rated = after.rated;
  if (before.attackOption !== after.attackOption) {
    out.attackOption = after.attackOption;
  }
  if (before.range !== after.range) out.range = after.range;
  return out;
}
