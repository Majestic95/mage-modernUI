import type {
  ExistingSetClass,
  ExistingSetEntry,
  ImageSupportEntry,
  RepoScan,
  TokenDatabaseEntry,
  XmageCardIdentity,
} from './types';

export interface RepoFileProvider {
  listFiles(rootPath: string, relativeDir: string): Promise<string[]>;
  readText(rootPath: string, relativePath: string): Promise<string>;
}

const CARD_CLASS_PATTERN = /public\s+(?:final\s+)?class\s+(\w+)\s+extends\s+/;
const ABSTRACT_CLASS_PATTERN = /public\s+abstract\s+class\s+\w+\s+extends\s+/;
const SET_SUPER_PATTERN = /super\("([^"]+)",\s*"([^"]+)"/;
const SET_CARD_PATTERN =
  /cards\.add\(new SetCardInfo\("([^"]+)",\s*"?(.*?)"?\s*,\s*Rarity\.(\w+),\s*mage\.cards\.([a-z]|basiclands)\.(\w+)\.class/;
const TOKEN_PATTERN = /^\|(TOK|EMBLEM|PLANE|DUNGEON):([^|]+)\|([^|]+)\|([^|]*)\|([^|]+)\|$/;
const IMAGE_SUPPORT_PATTERN = /put\("([^/"]+)\/([^/"]+)(?:\/([^/"]+))?",\s*"([^"]+)"\)/g;
const CARD_CLASS_DIRS = [
  'Mage.Sets/src/mage/cards',
  'Mage/src/main/java/mage/cards/basiclands',
];

export async function scanRepo(rootPath: string, provider: RepoFileProvider): Promise<RepoScan> {
  const [cardClasses, setData, tokenEntries, imageSupportEntries] = await Promise.all([
    scanCardClasses(rootPath, provider),
    scanSetData(rootPath, provider),
    scanTokenEntries(rootPath, provider),
    scanImageSupportEntries(rootPath, provider),
  ]);

  return {
    rootPath,
    cardClasses,
    setClasses: setData.setClasses,
    setEntries: setData.setEntries,
    tokenEntries,
    imageSupportEntries,
  };
}

export async function scanCardClasses(
  rootPath: string,
  provider: RepoFileProvider,
): Promise<Map<string, XmageCardIdentity>> {
  const files = Array.from(new Set((await Promise.all(
    CARD_CLASS_DIRS.map((directory) => provider.listFiles(rootPath, directory)),
  )).flat()));
  const result = new Map<string, XmageCardIdentity>();

  await eachWithConcurrency(
    files
      .filter((file) => file.endsWith('.java'))
      .map((file) => async () => {
        const text = await provider.readText(rootPath, file);
        if (ABSTRACT_CLASS_PATTERN.test(text)) return;
        const match = CARD_CLASS_PATTERN.exec(text);
        if (!match?.[1]) return;
        const className = match[1];
        const packageLetter = file.includes('/basiclands/') || file.includes('\\basiclands\\')
          ? 'basiclands'
          : className.charAt(0).toLowerCase();
        result.set(className, {
          cardName: className,
          className,
          packageLetter,
          classPath: normalizePath(file),
        });
      }),
  );

  return result;
}

export async function scanSetEntries(
  rootPath: string,
  provider: RepoFileProvider,
): Promise<ExistingSetEntry[]> {
  return (await scanSetData(rootPath, provider)).setEntries;
}

export async function scanSetData(
  rootPath: string,
  provider: RepoFileProvider,
): Promise<{ setClasses: Map<string, ExistingSetClass>; setEntries: ExistingSetEntry[] }> {
  const files = await provider.listFiles(rootPath, 'Mage.Sets/src/mage/sets');
  const setClasses = new Map<string, ExistingSetClass>();
  const entries: ExistingSetEntry[] = [];

  await eachWithConcurrency(
    files
      .filter((file) => file.endsWith('.java'))
      .map((file) => async () => {
        const text = await provider.readText(rootPath, file);
        const setMatch = SET_SUPER_PATTERN.exec(text);
        const setName = setMatch?.[1] ?? file.replace(/^.*[\\/]/, '').replace(/\.java$/, '');
        const setCode = setMatch?.[2] ?? '';
        const setClassName = file.replace(/^.*[\\/]/, '').replace(/\.java$/, '');
        if (setCode) {
          setClasses.set(setCode.toUpperCase(), {
            setCode,
            setName,
            setClassName,
            setPath: normalizePath(file),
          });
        }

        for (const line of text.split(/\r?\n/)) {
          const entryMatch = SET_CARD_PATTERN.exec(line);
          if (!entryMatch) continue;
          const [, cardName, collectorNumber, rarity, , className] = entryMatch;
          if (!cardName || !collectorNumber || !rarity || !className) continue;
          entries.push({
            setCode,
            setName,
            setClassName,
            cardName,
            collectorNumber,
            rarity,
            className,
            rawLine: line.trim(),
          });
        }
      }),
  );

  return { setClasses, setEntries: entries };
}

export async function scanTokenEntries(
  rootPath: string,
  provider: RepoFileProvider,
): Promise<TokenDatabaseEntry[]> {
  try {
    const text = await provider.readText(rootPath, 'Mage/src/main/resources/tokens-database.txt');
    return text
      .split(/\r?\n/)
      .map((line) => TOKEN_PATTERN.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({
        type: match[1] as TokenDatabaseEntry['type'],
        setCode: match[2] ?? '',
        tokenName: match[3] ?? '',
        imageNumber: match[4] ? match[4] : null,
        className: match[5] ?? '',
      }));
  } catch {
    return [];
  }
}

export async function scanImageSupportEntries(
  rootPath: string,
  provider: RepoFileProvider,
): Promise<ImageSupportEntry[]> {
  const files = [
    'Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportTokens.java',
    'Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportCards.java',
  ];
  const entries: ImageSupportEntry[] = [];

  await Promise.all(
    files.map(async (file) => {
      try {
        const text = await provider.readText(rootPath, file);
        for (const match of text.matchAll(IMAGE_SUPPORT_PATTERN)) {
          entries.push({
            setCode: match[1] ?? '',
            name: match[2] ?? '',
            imageNumber: match[3] ?? null,
            url: match[4] ?? '',
          });
        }
      } catch {
        // Missing image support files mean the target checkout is incomplete,
        // but scanning can still proceed for card/set data.
      }
    }),
  );

  return entries;
}

export function createBrowserFileProvider(files: FileList | File[]): RepoFileProvider {
  const fileArray = Array.from(files);
  const indexed = new Map<string, File>();
  const canonicalPathsByFile = new Map<File, string>();
  for (const file of fileArray) {
    const relative = normalizePath(file.webkitRelativePath || file.name);
    const rootless = stripLeadingRoot(relative);
    const canonical = rootless === relative ? relative : rootless;
    canonicalPathsByFile.set(file, canonical);
    indexed.set(relative, file);
    indexed.set(rootless, file);
  }

  return {
    async listFiles(_rootPath: string, relativeDir: string) {
      const normalizedDir = normalizePath(relativeDir).replace(/\/$/, '');
      return Array.from(new Set(canonicalPathsByFile.values()))
        .filter((path) => path.startsWith(`${normalizedDir}/`) || path.includes(`/${normalizedDir}/`));
    },
    async readText(_rootPath: string, relativePath: string) {
      const normalized = normalizePath(relativePath);
      const file = indexed.get(normalized) ?? indexed.get(stripLeadingRoot(normalized));
      if (!file) {
        throw new Error(`File not selected: ${relativePath}`);
      }
      return file.text();
    },
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function stripLeadingRoot(path: string): string {
  const parts = normalizePath(path).split('/');
  const mageIndex = parts.findIndex((part) => part === 'Mage.Sets' || part === 'Mage' || part === 'Mage.Client');
  return mageIndex >= 0 ? parts.slice(mageIndex).join('/') : path;
}

async function eachWithConcurrency(tasks: Array<() => Promise<void>>, concurrency = 16): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      await task?.();
    }
  });

  await Promise.all(workers);
}
