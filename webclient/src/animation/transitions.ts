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
