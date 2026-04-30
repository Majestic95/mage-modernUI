import { describe, expect, it } from 'vitest';
import {
  CARD_DRAW,
  CARD_HOVER_LIFT_MS,
  CARD_RESOLVE,
  CARD_TAP_ROTATE,
  CARD_TARGETED_PULSE_CLASS,
  CARD_TARGETED_PULSE_PERIOD_MS,
  DELTA_FLOAT_UP,
  ELIMINATION_PERMANENT_FADE,
  ELIMINATION_SLASH,
  HAND_HOVER_LIFT_MS,
  LAYOUT_GLIDE,
  LIFE_FLOATING_NUMBER,
  MANA_TAP_ROTATE,
  PLAYER_ACTIVE_HALO_CLASS,
  PLAYER_ACTIVE_HALO_PERIOD_MS,
  PRIORITY_TAG_FADE,
  STACK_GLOW_PULSE_CLASS,
  STACK_GLOW_PULSE_PERIOD_MS,
} from './transitions';

// Design-system §6.2 token easing curves. The Framer Motion named
// 'easeOut' string maps to a DIFFERENT curve (cubic-bezier(0,0,
// 0.58,1)); using strings would silently produce a softer ease than
// CSS rules using the token. Slice 70-B critic graphical-C1.
const EASE_OUT_TOKEN = [0.2, 0, 0, 1];
const EASE_IN_TOKEN = [0.4, 0, 1, 1];

/**
 * Slice 70-B — pins the new motion presets added for the design-system
 * push. Existing presets (LAYOUT_GLIDE, MANA_TAP_ROTATE, etc.) are
 * deliberately untested here — their parameters are stable and
 * already consumed across the app.
 *
 * Per ADR 0011 R2 the spec doc was reconciled to the registry, not
 * the other way around. These tests pin the registry side.
 */
describe('slice 70-B motion registry additions', () => {
  it('CARD_DRAW is a 250ms ease-out tween (token cubic-bezier)', () => {
    expect(CARD_DRAW.duration).toBe(0.25);
    expect(CARD_DRAW.ease).toEqual(EASE_OUT_TOKEN);
  });

  it('CARD_HOVER_LIFT_MS aliases HAND_HOVER_LIFT_MS at the 120ms spec value', () => {
    // Slice 70-G — graphical critic argued 150ms feels mechanical
    // for hover feedback; 120ms is the deliberate spec UX choice.
    // ADR R2's "preserve existing parameter" was about NOT silently
    // changing values; an explicit slice-70-G revisit is the right
    // place to overturn. Both the alias and the canonical name now
    // hold 120ms.
    expect(CARD_HOVER_LIFT_MS).toBe(HAND_HOVER_LIFT_MS);
    expect(CARD_HOVER_LIFT_MS).toBe(120);
  });

  it('PRIORITY_TAG_FADE is a 150ms ease-out tween (token cubic-bezier, NOT Framer easeOut string)', () => {
    expect(PRIORITY_TAG_FADE.duration).toBe(0.15);
    // Framer's named 'easeOut' is cubic-bezier(0,0,0.58,1) — a softer,
    // late-tail curve that does NOT match --motion-ease-out
    // (cubic-bezier(0.2,0,0,1)). Use the tuple form to lock the token
    // value into the registry.
    expect(PRIORITY_TAG_FADE.ease).toEqual(EASE_OUT_TOKEN);
  });

  it('ELIMINATION_SLASH and ELIMINATION_PERMANENT_FADE play in parallel with offset durations + token easings', () => {
    // Slash is 600ms ease-out; permanent fade is 800ms ease-in.
    // The fade is intentionally longer so the pod settles into the
    // eliminated state AFTER the slash visual resolves.
    expect(ELIMINATION_SLASH.duration).toBe(0.6);
    expect(ELIMINATION_SLASH.ease).toEqual(EASE_OUT_TOKEN);
    expect(ELIMINATION_PERMANENT_FADE.duration).toBe(0.8);
    expect(ELIMINATION_PERMANENT_FADE.ease).toEqual(EASE_IN_TOKEN);
    expect(ELIMINATION_PERMANENT_FADE.duration).toBeGreaterThan(
      ELIMINATION_SLASH.duration ?? 0,
    );
  });

  it('spec-aligned aliases preserve existing preset parameters (R2 mitigation)', () => {
    // Critic technical-N1 — adopt the alias pattern across every
    // spec-named existing preset so consumers can use one
    // vocabulary. Each alias is identity-equal to the original, so a
    // future param change to the original automatically propagates.
    expect(CARD_RESOLVE).toBe(LAYOUT_GLIDE);
    expect(CARD_TAP_ROTATE).toBe(MANA_TAP_ROTATE);
    expect(LIFE_FLOATING_NUMBER).toBe(DELTA_FLOAT_UP);
  });

  it('CSS keyframe class names match the index.css definitions', () => {
    // The CSS side defines @keyframes + .animate-* utility classes;
    // these constants are the typed contract between consumer code
    // and CSS. A typo on either side would break the animation.
    expect(STACK_GLOW_PULSE_CLASS).toBe('animate-stack-glow-pulse');
    expect(PLAYER_ACTIVE_HALO_CLASS).toBe('animate-player-active-halo');
    expect(CARD_TARGETED_PULSE_CLASS).toBe('animate-card-targeted-pulse');
  });

  it('keyframe periods avoid synchronized-peak LCM (slice 70-G coherence fix)', () => {
    // Slice 70-B's graphical critic flagged that 1.0/1.5/2.0s
    // shared LCM 6s, producing a perceptible peak-flash beat when
    // all three pulses are on screen. Slice 70-G shifted the
    // halo 2000→1900ms — new LCM ~19s, peaks drift across the
    // cycle instead of beating in sync. Off-spec by 5%; trade
    // accepted vs the perceptual hit.
    expect(STACK_GLOW_PULSE_PERIOD_MS).toBe(1500);
    expect(PLAYER_ACTIVE_HALO_PERIOD_MS).toBe(1900);
    expect(CARD_TARGETED_PULSE_PERIOD_MS).toBe(1000);
  });
});
