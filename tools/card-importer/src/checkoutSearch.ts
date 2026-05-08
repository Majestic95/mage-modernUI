import type { ExistingSetClass, ExistingSetEntry, RepoScan, XmageCardIdentity } from './types';
import { getCardIdentity, isCoreBasicLand, toSetClassName } from './xmageNaming';

export interface CheckoutSearchIndex {
  cardClasses: Map<string, XmageCardIdentity>;
  setClasses: Map<string, ExistingSetClass>;
  setEntriesBySetCode: Map<string, ExistingSetEntry[]>;
  setEntriesByClassName: Map<string, ExistingSetEntry[]>;
  setEntriesByCardName: Map<string, ExistingSetEntry[]>;
}

export interface CardSearchResult {
  query: string;
  identity: XmageCardIdentity;
  isEmptyQuery: boolean;
  classExists: boolean;
  classPath: string | null;
  expectedClassPath: string;
  setEntries: ExistingSetEntry[];
  notes: string[];
  warnings: string[];
}

export interface SetSearchResult {
  query: string;
  normalizedCode: string;
  isEmptyQuery: boolean;
  exists: boolean;
  setName: string | null;
  setClassName: string;
  setPath: string;
  expectedSetPath: string;
  entries: ExistingSetEntry[];
  uniqueCardCount: number;
}

export interface CardInSetSearchResult {
  card: CardSearchResult;
  set: SetSearchResult;
  matchingEntries: ExistingSetEntry[];
  status:
    | 'card-and-set-entry-exist'
    | 'class-exists-missing-set-entry'
    | 'set-missing'
    | 'card-missing'
    | 'empty-query'
    | 'set-exists-card-class-and-entry-missing';
}

export function createCheckoutSearchIndex(scan: RepoScan): CheckoutSearchIndex {
  const setEntriesBySetCode = new Map<string, ExistingSetEntry[]>();
  const setEntriesByClassName = new Map<string, ExistingSetEntry[]>();
  const setEntriesByCardName = new Map<string, ExistingSetEntry[]>();

  for (const entry of scan.setEntries) {
    pushMap(setEntriesBySetCode, entry.setCode.toUpperCase(), entry);
    pushMap(setEntriesByClassName, entry.className, entry);
    pushMap(setEntriesByCardName, normalizeName(entry.cardName), entry);
  }

  return {
    cardClasses: scan.cardClasses,
    setClasses: scan.setClasses,
    setEntriesBySetCode,
    setEntriesByClassName,
    setEntriesByCardName,
  };
}

export function searchCardInCheckout(index: CheckoutSearchIndex, cardName: string): CardSearchResult {
  const query = cardName.trim();
  const identity = getCardIdentity(query);
  const isEmptyQuery = query.length === 0;
  const existingClass = !isEmptyQuery ? index.cardClasses.get(identity.className) : undefined;
  const classEntries = !isEmptyQuery ? (index.setEntriesByClassName.get(identity.className) ?? []) : [];
  const nameEntries = !isEmptyQuery ? (index.setEntriesByCardName.get(normalizeName(query)) ?? []) : [];
  const setEntries = sortSetEntries(uniqueEntries([...classEntries, ...nameEntries]));
  const coreBasicLand = isCoreBasicLand(query);
  const notes: string[] = [];
  const warnings: string[] = [];

  if (isEmptyQuery) {
    notes.push('Type a card name to search the selected checkout.');
  } else if (coreBasicLand) {
    notes.push('Core basic land classes live in Mage/src/main/java/mage/cards/basiclands and are usually added only as set entries.');
  }
  if (!existingClass && setEntries.length > 0) {
    warnings.push('Set entries reference this card, but the selected files did not include a matching class scan result.');
  }
  if (existingClass && setEntries.length === 0) {
    warnings.push('Card class exists locally but is not registered in any scanned set.');
  }

  return {
    query,
    identity,
    isEmptyQuery,
    classExists: !isEmptyQuery && (existingClass !== undefined || coreBasicLand),
    classPath: existingClass?.classPath ?? (coreBasicLand ? identity.classPath : null),
    expectedClassPath: identity.classPath,
    setEntries,
    notes,
    warnings,
  };
}

export function searchSetInCheckout(index: CheckoutSearchIndex, setCode: string): SetSearchResult {
  const normalizedCode = setCode.trim().toUpperCase();
  const isEmptyQuery = normalizedCode.length === 0;
  const entries = sortSetEntries(!isEmptyQuery ? (index.setEntriesBySetCode.get(normalizedCode) ?? []) : []);
  const setClass = !isEmptyQuery ? index.setClasses.get(normalizedCode) : undefined;
  const firstEntry = entries[0];
  const setClassName = setClass?.setClassName ?? firstEntry?.setClassName ?? toSetClassName(normalizedCode);
  const expectedSetPath = `Mage.Sets/src/mage/sets/${setClassName}.java`;
  const uniqueCardCount = new Set(entries.map((entry) => entry.className)).size;

  return {
    query: setCode.trim(),
    normalizedCode,
    isEmptyQuery,
    exists: setClass !== undefined || firstEntry !== undefined,
    setName: setClass?.setName ?? firstEntry?.setName ?? null,
    setClassName,
    setPath: setClass?.setPath ?? expectedSetPath,
    expectedSetPath,
    entries,
    uniqueCardCount,
  };
}

export function searchCardInSet(index: CheckoutSearchIndex, cardName: string, setCode: string): CardInSetSearchResult {
  const card = searchCardInCheckout(index, cardName);
  const set = searchSetInCheckout(index, setCode);
  const matchingEntries = set.entries.filter(
    (entry) => entry.className === card.identity.className || sameName(entry.cardName, card.query),
  );

  let status: CardInSetSearchResult['status'];
  if (card.isEmptyQuery || set.isEmptyQuery) {
    status = 'empty-query';
  } else if (!set.exists) {
    status = 'set-missing';
  } else if (matchingEntries.length > 0) {
    status = 'card-and-set-entry-exist';
  } else if (card.classExists) {
    status = 'class-exists-missing-set-entry';
  } else {
    status = card.setEntries.length > 0 ? 'set-exists-card-class-and-entry-missing' : 'card-missing';
  }

  return {
    card,
    set,
    matchingEntries: sortSetEntries(matchingEntries),
    status,
  };
}

function sameName(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function pushMap(map: Map<string, ExistingSetEntry[]>, key: string, entry: ExistingSetEntry): void {
  const entries = map.get(key);
  if (entries) {
    entries.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

function uniqueEntries(entries: ExistingSetEntry[]): ExistingSetEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.setCode}|${entry.collectorNumber}|${entry.className}|${entry.rawLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortSetEntries(entries: ExistingSetEntry[]): ExistingSetEntry[] {
  return [...entries].sort((left, right) => {
    const setCompare = left.setCode.localeCompare(right.setCode);
    if (setCompare !== 0) return setCompare;
    return compareCollectorNumbers(left.collectorNumber, right.collectorNumber)
      || left.cardName.localeCompare(right.cardName)
      || left.className.localeCompare(right.className)
      || left.rawLine.localeCompare(right.rawLine);
  });
}

function compareCollectorNumbers(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumber = Number.isFinite(leftNumber);
  const rightIsNumber = Number.isFinite(rightNumber);
  if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;
  return left.localeCompare(right, undefined, { numeric: true });
}
