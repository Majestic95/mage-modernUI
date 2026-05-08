import { describe, expect, it } from 'vitest';
import { getCardIdentity, isCoreBasicLand, normalizeCollectorNumber, toXmageClassName } from './xmageNaming';

describe('xmageNaming', () => {
  it('converts card names to XMage class names', () => {
    expect(toXmageClassName('Angrath, the Flame-Chained')).toBe('AngrathTheFlameChained');
    expect(toXmageClassName('Double Jump // Flying Kick')).toBe('DoubleJumpFlyingKick');
    expect(toXmageClassName("April O'Neil, Human Element")).toBe('AprilONeilHumanElement');
    expect(toXmageClassName('Æther Spellbomb')).toBe('AetherSpellbomb');
  });

  it('returns card identity paths', () => {
    expect(getCardIdentity('Lightning Bolt')).toMatchObject({
      className: 'LightningBolt',
      packageLetter: 'l',
      classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
    });
  });

  it('routes core basic lands to the upstream Mage module and leaves Wastes in Mage.Sets', () => {
    expect(getCardIdentity('Plains')).toMatchObject({
      packageLetter: 'basiclands',
      classPath: 'Mage/src/main/java/mage/cards/basiclands/Plains.java',
    });
    expect(isCoreBasicLand('Plains')).toBe(true);
    expect(getCardIdentity('Wastes')).toMatchObject({
      packageLetter: 'w',
      classPath: 'Mage.Sets/src/mage/cards/w/Wastes.java',
    });
    expect(isCoreBasicLand('Wastes')).toBe(false);
  });

  it('normalizes collector number symbols', () => {
    expect(normalizeCollectorNumber('134†')).toBe('134+');
    expect(normalizeCollectorNumber('1★')).toBe('1*');
  });
});
