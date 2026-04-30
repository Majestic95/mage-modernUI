import type { Transition } from 'framer-motion';

/**
 * Single source of truth for Framer Motion springs / tweens used
 * across the game UI. Adding a new animation? Add a named preset
 * here first, then reference it from the consumer. The slowmo
 * debug knob (animation/debug.ts) wraps each preset at the CALL
 * SITE — do NOT bake slow() into the preset (would couple the
 * registry to debug behavior).
 *
 * Conventions:
 *   - `*_MS` constants are CSS transition-duration values in
 *     milliseconds (numbers). Used via inline transitionDuration.
 *   - All others are Framer Motion Transition objects.
 */

// Cross-zone glides (stack ↔ battlefield via cardId layoutId).
export const LAYOUT_GLIDE: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 26,
  mass: 0.7,
};

// Stack tile enter/exit. The motion's transition.layout is set to
// LAYOUT_GLIDE so cross-zone moves use the layout spring while the
// own enter/exit uses the stiffer STACK spring.
export const STACK_ENTER_EXIT: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 30,
  mass: 0.6,
  layout: LAYOUT_GLIDE,
};

// Battlefield permanent enter/exit (ETB / leaves). Slightly heavier
// than stack to read as "settling" rather than "popping."
export const BATTLEFIELD_ENTER_EXIT: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 32,
  mass: 0.7,
  layout: LAYOUT_GLIDE,
};

// Life total scale-pop on change (1.25 → 1). Stiff + low damping
// for a satisfying snap.
export const LIFE_FLASH_POP: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 18,
};

// Life delta ±N indicator floating up + fading out.
export const DELTA_FLOAT_UP: Transition = {
  duration: 0.7,
  ease: 'easeOut',
};

// Permanent tap/untap rotation. Stiff + low damping for satisfying
// overshoot — the rotation visibly springs past 90° and settles back.
// Faster than BATTLEFIELD_ENTER_EXIT because it's frequent (every
// land tap, every turn).
export const MANA_TAP_ROTATE: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 20,
  mass: 0.5,
};

// Mana symbol entering the pool (you tap a land). Punchy pop-in;
// matches the LIFE_FLASH_POP energy because both communicate
// "you just gained a resource."
export const MANA_POOL_POP: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 18,
  mass: 0.4,
};

// Mana symbol leaving the pool (paid into a spell). Quick easeOut —
// mana is consumed, not celebrated.
export const MANA_POOL_FADE: Transition = {
  duration: 0.35,
  ease: 'easeOut',
};

// Damage flash overlay — short red pulse (opacity 0 → 0.4 → 0) when
// a creature takes damage. Duration short enough (~250ms) to complete
// before the BATTLEFIELD_ENTER_EXIT exit fires for a damaged-to-death
// creature, so the user sees the flicker before the slide-out.
//
// Used as keyframe values + transition together at the call site:
//   animate={{ opacity: [0, 0.4, 0] }}
//   transition={slow(DAMAGE_FLASH)}
export const DAMAGE_FLASH: Transition = {
  duration: 0.25,
  times: [0, 0.4, 1],
};

// Counter chip scale-pop on +1/+1 (or any counter) increase. Same
// energy as LIFE_FLASH_POP — both communicate "you just gained
// something." Aliased rather than duplicated so the call-site
// vocabulary reads as the intent (counter pop, not life flash).
export const COUNTER_POP = LIFE_FLASH_POP;

// Stagger delay between successive untap rotations (in milliseconds).
// 50ms × N creatures gives a wave effect at start-of-turn untap.
export const UNTAP_STAGGER_DELAY_MS = 50;

// CSS transition-duration values in milliseconds.
export const STACK_ZONE_COLLAPSE_MS = 200;
export const LIFE_TOTAL_COLOR_MS = 300;
export const HAND_HOVER_LIFT_MS = 150;
// TAP_ROTATE_MS removed in slice 58 — Framer Motion's MANA_TAP_ROTATE
// spring (above) replaces the linear CSS transition for permanent
// tap/untap. No CSS consumers remain.

// ---------------------------------------------------------------
// Slice 70-B (ADR 0011 D4) — design-system motion registry additions.
// Each new preset maps to a named motion in
// docs/design/design-system.md §6.4. Existing presets above keep
// their parameters unchanged (R2 risk mitigation); new aliases
// reference existing presets where the spec name overlaps.
// ---------------------------------------------------------------

/**
 * Token-aligned easing curves. The design-system §6.2 tokens are:
 *   --motion-ease-out — cubic-bezier(0.2, 0, 0, 1) — entering motion
 *   --motion-ease-in  — cubic-bezier(0.4, 0, 1, 1) — exit motion
 *
 * Framer Motion's named string `'easeOut'` is `cubic-bezier(0, 0,
 * 0.58, 1)` — the classic CSS curve, NOT the design token. Using the
 * named string in a Transition would give a softer, more rounded
 * curve than the token's front-loaded one. Slice 70-B critic
 * graphical-C1 flagged this; we encode the actual token values as
 * tuples here so every preset that says "ease-out" produces the same
 * visual curve as a CSS rule that uses the token.
 */
const EASE_OUT_TOKEN: readonly [number, number, number, number] = [0.2, 0, 0, 1];
const EASE_IN_TOKEN: readonly [number, number, number, number] = [0.4, 0, 1, 1];

/**
 * Card slides from library position to hand position. Used by
 * `card-draw` (single draw) and as the per-card motion inside the
 * `game-start-deal` stagger. Tween (not spring) because the
 * deal-cadence needs a fixed duration. Scale 0.85 → 1.0 plays in
 * parallel; the consumer applies the keyframe values.
 *
 * <p>Spec: 250ms `--motion-ease-out`.
 */
export const CARD_DRAW: Transition = {
  duration: 0.25,
  ease: [...EASE_OUT_TOKEN],
};

/**
 * Hand-card hover-lift. Spec name aligns with
 * design-system.md §6.4 `card-hover-lift`. Aliases the existing
 * {@link HAND_HOVER_LIFT_MS} so current behavior is preserved
 * verbatim — the spec doc was reconciled to 150ms (R2).
 */
export const CARD_HOVER_LIFT_MS = HAND_HOVER_LIFT_MS;

/**
 * Priority-tag fade-in / fade-out. Used with AnimatePresence: the
 * tag fades in at 150ms when priority is held by the local player,
 * fades out at 150ms when priority passes.
 *
 * <p>Spec: 150ms `--motion-ease-out`.
 */
export const PRIORITY_TAG_FADE: Transition = {
  duration: 0.15,
  ease: [...EASE_OUT_TOKEN],
};

/**
 * Diagonal claw-rip overlay across an eliminated player's pod. Plays
 * once at game-state-eliminated and persists.
 *
 * <p>Spec: 600ms `--motion-ease-out`. The accompanying permanent-fade
 * ({@link ELIMINATION_PERMANENT_FADE}) plays in parallel at 800ms.
 * Slice 70-B ships the registry; slice 70-D consumes it on the
 * eliminated-player overlay.
 */
export const ELIMINATION_SLASH: Transition = {
  duration: 0.6,
  ease: [...EASE_OUT_TOKEN],
};

/**
 * Permanent-pod fade-out for an eliminated player. Plays in parallel
 * with {@link ELIMINATION_SLASH}; the slash completes first (600ms)
 * while the fade runs longer (800ms) so the pod settles into its
 * eliminated state after the slash visual has resolved.
 *
 * <p>Spec: 800ms `--motion-ease-in`.
 */
export const ELIMINATION_PERMANENT_FADE: Transition = {
  duration: 0.8,
  ease: [...EASE_IN_TOKEN],
};

/**
 * Spec-aligned aliases for existing presets. Per ADR 0011 R2 the
 * existing presets keep their parameters; these aliases let consumer
 * code read in the design-system vocabulary without a parameter
 * change.
 *
 * <p>Critic technical-N1 fix: previously only {@link CARD_HOVER_LIFT_MS}
 * had a spec-aligned alias, which was inconsistent. The four aliases
 * below cover every spec-named existing preset so consumers in slice
 * 70-D / 70-F can use one vocabulary across the registry.
 */
export const CARD_RESOLVE = LAYOUT_GLIDE;
export const CARD_TAP_ROTATE = MANA_TAP_ROTATE;
export const LIFE_FLOATING_NUMBER = DELTA_FLOAT_UP;

/**
 * CSS class names for ambient + pulse keyframe animations defined in
 * src/index.css. Exported as typed constants so consumers reference
 * the spec name rather than a magic string.
 *
 * <p><b>Pulse-color contract</b> (critic graphical-N7) — these
 * keyframes modulate INTENSITY (opacity / shadow alpha), not the base
 * color. The host element must already render its own glow source
 * (a colored box-shadow, ring, or background); the class amplifies
 * and softens the glow over the cycle. The {@link
 * #CARD_TARGETED_PULSE_CLASS} keyframe is the exception — it drives
 * its own purple targeted-frame color as a self-contained box-shadow,
 * since targeting is a transient state with no resting visual.
 *
 * <p><b>Reduced-motion behavior</b>: these are NON-essential
 * animations. The global `prefers-reduced-motion` rule kills them by
 * default. Consumers do NOT mark the host element with
 * `data-essential-motion` — that attribute is reserved for card-zone
 * movement (LAYOUT_GLIDE, BATTLEFIELD_ENTER_EXIT, STACK_ENTER_EXIT)
 * which conveys game state and must not be silenced.
 */
export const STACK_GLOW_PULSE_CLASS = 'animate-stack-glow-pulse';
export const PLAYER_ACTIVE_HALO_CLASS = 'animate-player-active-halo';
export const CARD_TARGETED_PULSE_CLASS = 'animate-card-targeted-pulse';

/**
 * Keyframe period (ms) for the three pulse animations. Exposed so
 * tests + tooling can reason about cadence; the actual `animation:`
 * shorthand lives in src/index.css alongside the keyframes.
 *
 * <p>Spec periods: stack-glow-pulse 1500ms, player-active-halo
 * 2000ms, card-targeted-pulse 1000ms (1Hz per design-system §6.4).
 */
export const STACK_GLOW_PULSE_PERIOD_MS = 1500;
export const PLAYER_ACTIVE_HALO_PERIOD_MS = 2000;
export const CARD_TARGETED_PULSE_PERIOD_MS = 1000;

/**
 * Slice 70-F (ADR 0011 D5) — ambient particle-drift backdrop. CSS
 * keyframe defined in src/index.css; consumers apply this class to
 * an absolutely-positioned div behind the battlefield content.
 *
 * <p>Reduced-motion: silenced by the global rule (no
 * data-essential-motion) — the keyframe is purely aesthetic, not
 * state-conveying. Slow 60-second cycle to read as "alive" without
 * distracting from gameplay.
 */
export const PARTICLE_DRIFT_CLASS = 'animate-particle-drift';
export const PARTICLE_DRIFT_PERIOD_MS = 60_000;
