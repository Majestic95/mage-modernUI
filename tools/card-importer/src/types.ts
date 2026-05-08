export type ImportDifficulty =
  | 'reprint'
  | 'simple-stub'
  | 'known-mechanic'
  | 'needs-engine-work';

export type GeneratedChangeKind =
  | 'card-class'
  | 'set-entry'
  | 'token-database'
  | 'image-support'
  | 'checklist';

export type ImportIssueSeverity = 'info' | 'warning' | 'error';

export interface ImportedCardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
}

export interface ImportedCard {
  name: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  layout: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  faces: ImportedCardFace[];
  keywords: string[];
  isReprint: boolean;
  scryfallUri: string | null;
}

export interface ImportedSet {
  code: string;
  name: string;
  releaseDate: string;
  setType: string;
  cards: ImportedCard[];
}

export interface XmageCardIdentity {
  cardName: string;
  className: string;
  packageLetter: string;
  classPath: string;
}

export interface ExistingSetEntry {
  setCode: string;
  setName: string;
  setClassName: string;
  cardName: string;
  collectorNumber: string;
  rarity: string;
  className: string;
  rawLine: string;
}

export interface ExistingSetClass {
  setCode: string;
  setName: string;
  setClassName: string;
  setPath: string;
}

export interface RepoScan {
  rootPath: string;
  cardClasses: Map<string, XmageCardIdentity>;
  setClasses: Map<string, ExistingSetClass>;
  setEntries: ExistingSetEntry[];
  tokenEntries: TokenDatabaseEntry[];
  imageSupportEntries: ImageSupportEntry[];
}

export interface TokenDatabaseEntry {
  type: 'TOK' | 'EMBLEM' | 'PLANE' | 'DUNGEON';
  setCode: string;
  tokenName: string;
  imageNumber: string | null;
  className: string;
}

export interface ImageSupportEntry {
  setCode: string;
  name: string;
  imageNumber: string | null;
  url: string;
}

export interface ImportIssue {
  severity: ImportIssueSeverity;
  title: string;
  detail: string;
}

export interface GeneratedChange {
  kind: GeneratedChangeKind;
  path: string;
  title: string;
  content: string;
  applied: false;
}

export interface ImportClassification {
  difficulty: ImportDifficulty;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  issues: ImportIssue[];
}

export interface ImportPlan {
  card: ImportedCard;
  identity: XmageCardIdentity;
  classification: ImportClassification;
  changes: GeneratedChange[];
  verificationCommands: string[];
}

export interface BatchSetPlan {
  set: ImportedSet;
  cardPlans: ImportPlan[];
  summary: {
    reprints: number;
    simpleStubs: number;
    knownMechanics: number;
    needsEngineWork: number;
  };
}
