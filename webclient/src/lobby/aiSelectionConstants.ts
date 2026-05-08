/**
 * AI-selector constants extracted from {@link PreLobbyAiSection.tsx}
 * to keep that file react-refresh-clean (the
 * `react-refresh/only-export-components` rule disallows non-component
 * exports from a file that also exports components). Same pattern as
 * `manaPoolUtil.ts` for `ManaPool.tsx`.
 *
 * <p>No JSX in this file — pure constants + types — hence the
 * {@code .ts} extension.
 */

/**
 * AI types the user can pick when filling seats. Order = display order;
 * the first entry is the default selection. MAD (`ComputerPlayer7`)
 * leads because it's the engine-blessed playable AI; MCTS is exposed
 * as an "experimental" alternative.
 *
 * <p>Hardcoded rather than derived from {@code serverState.playerTypes}
 * so unforeseen PlayerType enum additions don't accidentally surface
 * in the UI without explicit review (e.g. Draft-only bots, or a
 * future custom Commander AI that needs its own labelling). When a
 * new playable AI lands, append a row here.
 */
export const AI_OPTIONS = [
  {
    value: 'COMPUTER_MAD',
    label: 'MAD (recommended)',
    hint: 'Simulation-based AI. Plays strategically.',
  },
  {
    value: 'COMPUTER_MONTE_CARLO',
    label: 'Monte Carlo',
    hint: 'MCTS search. Experimental — may pass priority often.',
  },
] as const;

export type AiTypeValue = (typeof AI_OPTIONS)[number]['value'];

export const DEFAULT_AI_TYPE: AiTypeValue = AI_OPTIONS[0].value;

/**
 * AI difficulty tiers exposed by Slice D's wire surface (schema 1.34).
 * Wire values are lowercase per {@code AiDifficulty.fromString}; the
 * order here is "default first" so the dropdown opens on the
 * recommended pick.
 *
 * <p>Labels surface the bracket so users can self-calibrate even if
 * they haven't read the deck-pool docs. Detailed deck-shape rationale
 * lives in {@code docs/decisions/ai-commander-rebalance-2026-05.md}
 * and the {@code CommanderDecks*.java} class Javadoc.
 */
export const AI_DIFFICULTIES = [
  {
    value: 'medium',
    label: 'Medium — Bracket 2-3 (default)',
    hint: 'Mild engines, no exponential snowballs. Recommended.',
  },
  {
    value: 'easy',
    label: 'Easy — Bracket 1',
    hint: 'Vanilla creatures, no anthems. Casual / battlecruiser.',
  },
  {
    value: 'hard',
    label: 'Hard — Bracket 3-4',
    hint: 'Full synergy decks. Expect Craterhoof / Coat of Arms.',
  },
] as const;

export type AiDifficultyValue = (typeof AI_DIFFICULTIES)[number]['value'];

export const DEFAULT_AI_DIFFICULTY: AiDifficultyValue = AI_DIFFICULTIES[0].value;
