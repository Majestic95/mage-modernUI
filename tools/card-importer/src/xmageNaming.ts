import type { XmageCardIdentity } from './types';

const CORE_BASIC_LAND_CLASSES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);

export function toXmageClassName(cardName: string): string {
  return transliterateCardName(cardName)
    .replace(/\s*\/\/\s*/g, '')
    .replace(/&/g, 'And')
    .replace(/[^\w'\s-]/g, '')
    .replace(/\b([\w']+)/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))
    .replace(/[-\s']/g, '');
}

export function packageLetterForCard(cardName: string): string {
  const className = toXmageClassName(cardName);
  return className.charAt(0).toLowerCase();
}

export function getCardIdentity(cardName: string): XmageCardIdentity {
  const className = toXmageClassName(cardName);
  const packageLetter = CORE_BASIC_LAND_CLASSES.has(className)
    ? 'basiclands'
    : className.charAt(0).toLowerCase();
  const classPath =
    packageLetter === 'basiclands'
      ? `Mage/src/main/java/mage/cards/basiclands/${className}.java`
      : `Mage.Sets/src/mage/cards/${packageLetter}/${className}.java`;

  return {
    cardName,
    className,
    packageLetter,
    classPath,
  };
}

export function isCoreBasicLand(cardName: string): boolean {
  return CORE_BASIC_LAND_CLASSES.has(toXmageClassName(cardName));
}

export function toSetClassName(setName: string): string {
  return transliterateCardName(setName)
    .replace(/&/g, 'And')
    .replace(/[^\w'\s-]/g, '')
    .replace(/\b([\w']+)/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))
    .replace(/[-\s']/g, '');
}

export function normalizeCollectorNumber(number: string): string {
  return number.replace(/★/g, '*').replace(/†/g, '+');
}

function transliterateCardName(value: string): string {
  return value
    .replace(/Æ/g, 'Ae')
    .replace(/æ/g, 'ae')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}
