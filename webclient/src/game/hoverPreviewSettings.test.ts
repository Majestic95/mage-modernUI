import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  POPOVER_BASE_WIDTH_PX,
  POPOVER_MAX_SCALE,
  POPOVER_MIN_SCALE,
  popoverWidthPx,
  useHoverPreviewSettings,
} from './hoverPreviewSettings';

const STORAGE_KEY = 'xmage.hoverPreview.v1';

describe('hoverPreviewSettings — store defaults + persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    // Reset zustand state to a fresh load() result so each test starts clean.
    useHoverPreviewSettings.setState({ popoverScale: 1.0 });
  });
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('defaults popoverScale to 1.0', () => {
    expect(useHoverPreviewSettings.getState().popoverScale).toBe(1.0);
  });

  it('setPopoverScale updates state and writes to localStorage', () => {
    useHoverPreviewSettings.getState().setPopoverScale(2.0);
    expect(useHoverPreviewSettings.getState().popoverScale).toBe(2.0);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ popoverScale: 2.0 });
  });

  it('clamps values below MIN_SCALE up to MIN_SCALE', () => {
    useHoverPreviewSettings.getState().setPopoverScale(0.2);
    expect(useHoverPreviewSettings.getState().popoverScale).toBe(
      POPOVER_MIN_SCALE,
    );
  });

  it('clamps values above MAX_SCALE down to MAX_SCALE', () => {
    useHoverPreviewSettings.getState().setPopoverScale(99);
    expect(useHoverPreviewSettings.getState().popoverScale).toBe(
      POPOVER_MAX_SCALE,
    );
  });

  it('rejects non-finite values without changing state', () => {
    useHoverPreviewSettings.getState().setPopoverScale(1.5);
    useHoverPreviewSettings.getState().setPopoverScale(Number.NaN);
    expect(useHoverPreviewSettings.getState().popoverScale).toBe(1.5);
  });
});

describe('popoverWidthPx', () => {
  it('multiplies the base 256 px by scale and rounds', () => {
    expect(popoverWidthPx(1.0)).toBe(POPOVER_BASE_WIDTH_PX);
    expect(popoverWidthPx(2.0)).toBe(POPOVER_BASE_WIDTH_PX * 2);
    expect(popoverWidthPx(3.0)).toBe(POPOVER_BASE_WIDTH_PX * 3);
    // Rounded
    expect(popoverWidthPx(1.5)).toBe(384);
    expect(popoverWidthPx(2.7)).toBe(691);
  });
});
