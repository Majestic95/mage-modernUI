import type {
  ExistingSetClass,
  ExistingSetEntry,
  ImageSupportEntry,
  RepoScan,
  TokenDatabaseEntry,
  XmageCardIdentity,
} from './types';

interface NativeRepoScanPayload {
  rootPath: string;
  cardClasses: XmageCardIdentity[];
  setClasses: ExistingSetClass[];
  setEntries: ExistingSetEntry[];
  tokenEntries: Array<Omit<TokenDatabaseEntry, 'type'> & { kind: TokenDatabaseEntry['type'] }>;
  imageSupportEntries: ImageSupportEntry[];
  scanMethod: string;
}

export interface NativeRuntimeWindow {
  __TAURI_INTERNALS__?: unknown;
}

export interface NativeRepoScanResult {
  scan: RepoScan;
  scanMethod: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function pickAndScanNativeRepo(): Promise<NativeRepoScanResult | null> {
  const [{ open }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select XMage checkout',
  });
  if (typeof selected !== 'string') return null;

  const payload = await invoke<NativeRepoScanPayload>('scan_xmage_repo', { rootPath: selected });
  return mapNativeRepoScan(payload);
}

export function mapNativeRepoScan(payload: NativeRepoScanPayload): NativeRepoScanResult {
  return {
    scan: {
      rootPath: payload.rootPath,
      cardClasses: new Map(payload.cardClasses.map((entry) => [entry.className, entry])),
      setClasses: new Map(payload.setClasses.map((entry) => [entry.setCode.toUpperCase(), entry])),
      setEntries: payload.setEntries,
      tokenEntries: payload.tokenEntries.map(({ kind, ...entry }) => ({
        ...entry,
        type: kind,
      })),
      imageSupportEntries: payload.imageSupportEntries,
    },
    scanMethod: payload.scanMethod,
  };
}
