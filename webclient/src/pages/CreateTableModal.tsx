import { useRef, useState, type FormEvent } from 'react';
import { ApiError, request } from '../api/client';
import { webTableSchema, type WebServerState } from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { useModalA11y } from '../util/useModalA11y';

interface Props {
  roomId: string;
  serverState: WebServerState;
  onClose: () => void;
  onCreated: () => void;
}

type AiType = 'COMPUTER_MONTE_CARLO' | 'COMPUTER_MAD';

/**
 * Modal form for {@code POST /api/rooms/{roomId}/tables}. Three fields
 * are required ({@code gameType}, {@code deckType}, {@code winsNeeded});
 * everything else lives under the collapsible "Advanced options"
 * section and inherits server defaults when left empty.
 *
 * <p>The advanced fields mirror upstream {@link mage.game.match.MatchOptions}:
 * password, skill level, match time limit, spectators-allowed, rated,
 * free mulligans, mulligan type, attack option, and range of influence.
 * The latter two are only meaningful on multiplayer games and are
 * gated on {@code GameType.useAttackOption} / {@code GameType.useRange}.
 */
export function CreateTableModal({ roomId, serverState, onClose, onCreated }: Props) {
  const session = useAuthStore((s) => s.session);

  const initialGameType = serverState.gameTypes[0]?.name ?? '';
  // Default deck format: prefer Freeform Unlimited (no card pool /
  // quantity restrictions) so the AI's fallback Bears deck and
  // user-imported old-card decks always validate. Fall back to
  // Vintage (permissive: any pre-restricted card pool) and finally
  // to the first format the server lists. Without this default,
  // Standard was selected and dev decks failed legality checks
  // — see slice 24 commit notes.
  const PREFERRED_DEV_FORMATS = [
    'Constructed - Freeform Unlimited',
    'Constructed - Vintage',
  ];
  const initialDeckType = (() => {
    for (const wanted of PREFERRED_DEV_FORMATS) {
      if (serverState.deckTypes.includes(wanted)) return wanted;
    }
    return serverState.deckTypes[0] ?? '';
  })();

  const [gameType, setGameType] = useState(initialGameType);
  const [deckType, setDeckType] = useState(initialDeckType);
  const [winsNeeded, setWinsNeeded] = useState(1);
  const [addAi, setAddAi] = useState(true);
  // Default to MAD — upstream's MCTS player has a known
  // null-ability crash that ends the game (mage.MageException:
  // "Error in unit tests" → FATAL: Game end on critical error).
  // Mad is the rule-based AI and is much more stable for everyday
  // testing. Reorder + warning copy lives in the dropdown below.
  const [aiType, setAiType] = useState<AiType>('COMPUTER_MAD');

  // Advanced options — defaults align with MatchOptionsBuilder.build().
  const [tableName, setTableName] = useState('');
  const [password, setPassword] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('CASUAL');
  const [matchTimeLimit, setMatchTimeLimit] = useState<MatchTimeLimit>('NONE');
  const [spectatorsAllowed, setSpectatorsAllowed] = useState(true);
  const [rated, setRated] = useState(false);
  const [freeMulligans, setFreeMulligans] = useState(0);
  const [mulliganType, setMulliganType] = useState<MulliganType>('GAME_DEFAULT');
  const [attackOption, setAttackOption] = useState<AttackOption>('LEFT');
  const [rangeOfInfluence, setRangeOfInfluence] = useState<RangeOfInfluence>('ALL');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGame = serverState.gameTypes.find((g) => g.name === gameType);
  const aiAllowed = selectedGame?.maxPlayers === 2;
  const showAttackOption = selectedGame?.useAttackOption ?? false;
  const showRange = selectedGame?.useRange ?? false;

  // ESC key dismisses the modal (and focus trap + restore is wired
  // by the same hook). The submitting guard is preserved by passing
  // a noop when in-flight; the hook still owns ESC otherwise.
  const modalRootRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalRootRef, {
    onClose: submitting ? undefined : onClose,
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) {
      setError('Not signed in.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const seats = aiAllowed && addAi ? ['HUMAN', aiType] : undefined;
    const body: Record<string, unknown> = {
      gameType,
      deckType,
      winsNeeded,
    };
    if (seats) body['seats'] = seats;

    // Advanced options — omit when at default to keep the wire body
    // small and let the server own the defaults. Strings only ship
    // when non-blank; enums only when changed from default.
    const trimmedTableName = tableName.trim();
    if (trimmedTableName) body['tableName'] = trimmedTableName;
    if (password) body['password'] = password;
    if (skillLevel !== 'CASUAL') body['skillLevel'] = skillLevel;
    if (matchTimeLimit !== 'NONE') body['matchTimeLimit'] = matchTimeLimit;
    if (!spectatorsAllowed) body['spectatorsAllowed'] = false;
    if (rated) body['rated'] = true;
    if (freeMulligans > 0) body['freeMulligans'] = freeMulligans;
    if (mulliganType !== 'GAME_DEFAULT') body['mulliganType'] = mulliganType;
    if (showAttackOption && attackOption !== 'LEFT') {
      body['attackOption'] = attackOption;
    }
    if (showRange && rangeOfInfluence !== 'ALL') {
      body['range'] = rangeOfInfluence;
    }

    let created;
    try {
      created = await request(`/api/rooms/${roomId}/tables`, webTableSchema, {
        token: session.token,
        body,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create table.');
      setSubmitting(false);
      return;
    }

    // If the user asked for an AI opponent, fill the declared COMPUTER
    // seat now. Any failure here is a partial-success state: the table
    // exists, but the AI didn't join. Surface a warning and let the
    // user retry / leave / kill the table from the lobby.
    if (aiAllowed && addAi) {
      try {
        await request(
          `/api/rooms/${roomId}/tables/${created.tableId}/ai`,
          null,
          {
            token: session.token,
            method: 'POST',
            body: { playerType: aiType },
          },
        );
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Table created but AI failed to join: ${err.message}`
            : 'Table created but AI failed to join.',
        );
        setSubmitting(false);
        // Refresh the lobby anyway so the user sees the partial table.
        onCreated();
        return;
      }
    }

    onCreated();
    onClose();
  };

  return (
    <div
      ref={modalRootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-table-heading"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-baseline justify-between">
          <h2 id="create-table-heading" className="text-xl font-semibold">Create table</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-zinc-400 hover:text-zinc-100 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <Field label="Game type">
          <select
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
            className={selectClasses}
          >
            {serverState.gameTypes.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Deck format">
          <select
            value={deckType}
            onChange={(e) => setDeckType(e.target.value)}
            className={selectClasses}
          >
            {serverState.deckTypes.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Wins needed">
          <input
            type="number"
            min={1}
            max={5}
            value={winsNeeded}
            onChange={(e) => setWinsNeeded(Number(e.target.value) || 1)}
            className={inputClasses}
          />
        </Field>

        <fieldset className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={aiAllowed && addAi}
              disabled={!aiAllowed}
              onChange={(e) => setAddAi(e.target.checked)}
              className="accent-fuchsia-500"
            />
            <span className={aiAllowed ? '' : 'text-zinc-500'}>
              Add AI opponent
            </span>
          </label>
          {aiAllowed && addAi && (
            <>
              <select
                value={aiType}
                onChange={(e) => setAiType(e.target.value as AiType)}
                className={selectClasses + ' mt-2'}
              >
                <option value="COMPUTER_MAD">Computer — Mad</option>
                <option value="COMPUTER_MONTE_CARLO">
                  Computer — Monte Carlo (may crash)
                </option>
              </select>
              {aiType === 'COMPUTER_MONTE_CARLO' && (
                <p className="text-[11px] text-amber-300/80 mt-1">
                  ⚠ Upstream MCTS player has a known crash that ends
                  the match (null-ability fatal during simulation).
                  Mad is the rule-based AI — more stable.
                </p>
              )}
            </>
          )}
          {!aiAllowed && (
            <p className="text-xs text-zinc-500">
              Available only on 2-seat games (multi-AI is later phase).
            </p>
          )}
        </fieldset>

        <details className="border border-zinc-800 rounded">
          <summary
            className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/50"
            data-testid="advanced-summary"
          >
            Advanced options
          </summary>
          <div className="space-y-3 p-3 border-t border-zinc-800">
            <Field label="Table name (optional)">
              <input
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="Server picks a default if blank"
                className={inputClasses}
                maxLength={80}
              />
            </Field>

            <Field label="Password (optional)">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for an open table"
                className={inputClasses}
                maxLength={40}
                autoComplete="new-password"
              />
            </Field>

            <Field label="Skill level">
              <select
                value={skillLevel}
                onChange={(e) => setSkillLevel(e.target.value as SkillLevel)}
                className={selectClasses}
              >
                <option value="BEGINNER">Beginner</option>
                <option value="CASUAL">Casual</option>
                <option value="SERIOUS">Serious</option>
              </select>
            </Field>

            <Field label="Match time limit">
              <select
                value={matchTimeLimit}
                onChange={(e) => setMatchTimeLimit(e.target.value as MatchTimeLimit)}
                className={selectClasses}
              >
                <option value="NONE">None</option>
                <option value="MIN___5">5 minutes</option>
                <option value="MIN__10">10 minutes</option>
                <option value="MIN__15">15 minutes</option>
                <option value="MIN__20">20 minutes</option>
                <option value="MIN__25">25 minutes</option>
                <option value="MIN__30">30 minutes</option>
                <option value="MIN__35">35 minutes</option>
                <option value="MIN__40">40 minutes</option>
                <option value="MIN__45">45 minutes</option>
                <option value="MIN__50">50 minutes</option>
                <option value="MIN__55">55 minutes</option>
                <option value="MIN__60">60 minutes</option>
                <option value="MIN__90">90 minutes</option>
                <option value="MIN_120">120 minutes</option>
              </select>
            </Field>

            <Field label="Free mulligans">
              <input
                type="number"
                min={0}
                max={5}
                value={freeMulligans}
                onChange={(e) => setFreeMulligans(Math.max(0, Number(e.target.value) || 0))}
                className={inputClasses}
              />
            </Field>

            <Field label="Mulligan type">
              <select
                value={mulliganType}
                onChange={(e) => setMulliganType(e.target.value as MulliganType)}
                className={selectClasses}
              >
                <option value="GAME_DEFAULT">Game default</option>
                <option value="LONDON">London</option>
                <option value="SMOOTHED_LONDON">Smoothed London</option>
                <option value="VANCOUVER">Vancouver</option>
                <option value="PARIS">Paris</option>
                <option value="CANADIAN_HIGHLANDER">Canadian Highlander</option>
              </select>
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={spectatorsAllowed}
                onChange={(e) => setSpectatorsAllowed(e.target.checked)}
                className="accent-fuchsia-500"
              />
              <span>Spectators allowed</span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rated}
                onChange={(e) => setRated(e.target.checked)}
                className="accent-fuchsia-500"
              />
              <span>Rated</span>
            </label>

            {showAttackOption && (
              <Field label="Multiplayer attack option">
                <select
                  value={attackOption}
                  onChange={(e) => setAttackOption(e.target.value as AttackOption)}
                  className={selectClasses}
                >
                  <option value="LEFT">Attack left</option>
                  <option value="RIGHT">Attack right</option>
                  <option value="MULTIPLE">Attack multiple players</option>
                </select>
              </Field>
            )}

            {showRange && (
              <Field label="Range of influence">
                <select
                  value={rangeOfInfluence}
                  onChange={(e) => setRangeOfInfluence(e.target.value as RangeOfInfluence)}
                  className={selectClasses}
                >
                  <option value="ALL">All</option>
                  <option value="ONE">One</option>
                  <option value="TWO">Two</option>
                </select>
              </Field>
            )}
          </div>
        </details>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !gameType || !deckType}
            data-testid="create-table-submit"
            className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white font-medium"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

type SkillLevel = 'BEGINNER' | 'CASUAL' | 'SERIOUS';
type MatchTimeLimit =
  | 'NONE'
  | 'MIN___5'
  | 'MIN__10'
  | 'MIN__15'
  | 'MIN__20'
  | 'MIN__25'
  | 'MIN__30'
  | 'MIN__35'
  | 'MIN__40'
  | 'MIN__45'
  | 'MIN__50'
  | 'MIN__55'
  | 'MIN__60'
  | 'MIN__90'
  | 'MIN_120';
type MulliganType =
  | 'GAME_DEFAULT'
  | 'LONDON'
  | 'SMOOTHED_LONDON'
  | 'VANCOUVER'
  | 'PARIS'
  | 'CANADIAN_HIGHLANDER';
type AttackOption = 'LEFT' | 'RIGHT' | 'MULTIPLE';
type RangeOfInfluence = 'ALL' | 'ONE' | 'TWO';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

const inputClasses =
  'w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-fuchsia-500';
const selectClasses = inputClasses;
