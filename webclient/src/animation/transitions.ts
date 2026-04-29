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

// CSS transition-duration values in milliseconds.
export const STACK_ZONE_COLLAPSE_MS = 200;
export const LIFE_TOTAL_COLOR_MS = 300;
export const HAND_HOVER_LIFT_MS = 150;
export const TAP_ROTATE_MS = 150;
