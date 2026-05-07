/**
 * Slice T4 — locks the static format-info map used by PreLobbyModal's
 * info panel.
 *
 * <p>Covers:
 * <ul>
 *   <li>known formats return the curated description + banlist URL</li>
 *   <li>unknown formats fall back to null (panel hides cleanly)</li>
 *   <li>every entry has a non-trivial description (no placeholders)</li>
 *   <li>every banlistUrl is https:// or null (no http:// leaks)</li>
 * </ul>
 */
import { describe, it, expect } from 'vitest';
import { getFormatInfo, FORMAT_INFO } from './formatInfo';

describe('getFormatInfo', () => {
  it('returns metadata for known Pauper format', () => {
    const info = getFormatInfo('Constructed - Pauper');
    expect(info).not.toBeNull();
    expect(info?.description).toMatch(/common/i);
    expect(info?.banlistUrl).toBe('https://magic.wizards.com/en/formats/pauper');
  });

  it('returns metadata for Commander', () => {
    const info = getFormatInfo('Commander');
    expect(info).not.toBeNull();
    expect(info?.description).toMatch(/100-card|singleton|commander/i);
    expect(info?.banlistUrl).toContain('mtgcommander.net');
  });

  it('returns metadata for Limited with a null banlist (no public banlist)', () => {
    const info = getFormatInfo('Limited');
    expect(info).not.toBeNull();
    expect(info?.banlistUrl).toBeNull();
  });

  it('returns null for unknown format', () => {
    expect(getFormatInfo('Some Custom Format')).toBeNull();
    expect(getFormatInfo('')).toBeNull();
  });

  it('every entry has a non-empty description', () => {
    for (const [name, info] of Object.entries(FORMAT_INFO)) {
      expect(
        info.description.length,
        `format "${name}" needs a description`,
      ).toBeGreaterThan(20);
    }
  });

  it('every banlistUrl is https or null', () => {
    for (const [name, info] of Object.entries(FORMAT_INFO)) {
      if (info.banlistUrl !== null) {
        expect(
          info.banlistUrl,
          `format "${name}" banlist URL must be https`,
        ).toMatch(/^https:\/\//);
      }
    }
  });
});
