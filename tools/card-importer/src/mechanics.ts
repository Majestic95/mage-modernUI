export interface KnownKeywordMapping {
  keyword: string;
  javaExpression: string;
  importLine: string;
  confidence: 'high';
}

const SIMPLE_KEYWORDS: Record<string, KnownKeywordMapping> = {
  Deathtouch: {
    keyword: 'Deathtouch',
    javaExpression: 'DeathtouchAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.DeathtouchAbility;',
    confidence: 'high',
  },
  Defender: {
    keyword: 'Defender',
    javaExpression: 'DefenderAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.DefenderAbility;',
    confidence: 'high',
  },
  'Double strike': {
    keyword: 'Double strike',
    javaExpression: 'DoubleStrikeAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.DoubleStrikeAbility;',
    confidence: 'high',
  },
  FirstStrike: {
    keyword: 'FirstStrike',
    javaExpression: 'FirstStrikeAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.FirstStrikeAbility;',
    confidence: 'high',
  },
  'First strike': {
    keyword: 'First strike',
    javaExpression: 'FirstStrikeAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.FirstStrikeAbility;',
    confidence: 'high',
  },
  Flash: {
    keyword: 'Flash',
    javaExpression: 'FlashAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.FlashAbility;',
    confidence: 'high',
  },
  Flying: {
    keyword: 'Flying',
    javaExpression: 'FlyingAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.FlyingAbility;',
    confidence: 'high',
  },
  Haste: {
    keyword: 'Haste',
    javaExpression: 'HasteAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.HasteAbility;',
    confidence: 'high',
  },
  Hexproof: {
    keyword: 'Hexproof',
    javaExpression: 'HexproofAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.HexproofAbility;',
    confidence: 'high',
  },
  Indestructible: {
    keyword: 'Indestructible',
    javaExpression: 'IndestructibleAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.IndestructibleAbility;',
    confidence: 'high',
  },
  Lifelink: {
    keyword: 'Lifelink',
    javaExpression: 'LifelinkAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.LifelinkAbility;',
    confidence: 'high',
  },
  Menace: {
    keyword: 'Menace',
    javaExpression: 'MenaceAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.MenaceAbility;',
    confidence: 'high',
  },
  Reach: {
    keyword: 'Reach',
    javaExpression: 'ReachAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.ReachAbility;',
    confidence: 'high',
  },
  Trample: {
    keyword: 'Trample',
    javaExpression: 'TrampleAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.TrampleAbility;',
    confidence: 'high',
  },
  Vigilance: {
    keyword: 'Vigilance',
    javaExpression: 'VigilanceAbility.getInstance()',
    importLine: 'import mage.abilities.keyword.VigilanceAbility;',
    confidence: 'high',
  },
};

const PARAMETERIZED_KEYWORDS = new Set([
  'Afflict',
  'Annihilator',
  'Bestow',
  'Cycling',
  'Embalm',
  'Equip',
  'Kicker',
  'Madness',
  'Morph',
  'Mutate',
  'Outlast',
  'Plot',
  'Prototype',
  'Reconfigure',
  'Suspend',
  'Ward',
]);

export function getKeywordMapping(keyword: string): KnownKeywordMapping | null {
  return SIMPLE_KEYWORDS[keyword] ?? null;
}

export function isKnownKeyword(keyword: string): boolean {
  return getKeywordMapping(keyword) !== null;
}

export function isParameterizedKeyword(keyword: string): boolean {
  return PARAMETERIZED_KEYWORDS.has(keyword);
}

export function extractUnmappedRulesText(oracleText: string, keywords: string[]): string[] {
  const lowerKeywords = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  return oracleText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isOnlyKnownKeywordText(line, lowerKeywords));
}

function isOnlyKnownKeywordText(line: string, lowerKeywords: Set<string>): boolean {
  return line
    .replace(/\.$/, '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .every((part) => lowerKeywords.has(part));
}
