import { describe, expect, it } from 'vitest';
import { isTauriRuntime, mapNativeRepoScan, type NativeRuntimeWindow } from './nativeRepoScanner';

describe('nativeRepoScanner', () => {
  it('maps native scan arrays into RepoScan maps and token types', () => {
    const result = mapNativeRepoScan({
      rootPath: 'F:/xmage',
      cardClasses: [{
        cardName: 'LightningBolt',
        className: 'LightningBolt',
        packageLetter: 'l',
        classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
      }],
      setClasses: [{
        setCode: 'fdn',
        setName: 'Foundations',
        setClassName: 'Foundations',
        setPath: 'Mage.Sets/src/mage/sets/Foundations.java',
      }],
      setEntries: [{
        setCode: 'FDN',
        setName: 'Foundations',
        setClassName: 'Foundations',
        cardName: 'Lightning Bolt',
        collectorNumber: '123',
        rarity: 'COMMON',
        className: 'LightningBolt',
        rawLine: 'cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.COMMON, mage.cards.l.LightningBolt.class));',
      }],
      tokenEntries: [{
        kind: 'TOK',
        setCode: 'FDN',
        tokenName: 'Goblin',
        imageNumber: null,
        className: 'GoblinToken',
      }],
      imageSupportEntries: [],
      scanMethod: 'git-ls-files',
    });

    expect(result.scan.cardClasses.has('LightningBolt')).toBe(true);
    expect(result.scan.setClasses.has('FDN')).toBe(true);
    expect(result.scan.tokenEntries[0]?.type).toBe('TOK');
    expect(result.scanMethod).toBe('git-ls-files');
  });

  it('maps scan method diagnostics from native payloads', () => {
    const result = mapNativeRepoScan({
      rootPath: 'F:/xmage',
      cardClasses: [],
      setClasses: [],
      setEntries: [],
      tokenEntries: [],
      imageSupportEntries: [],
      scanMethod: 'filtered-filesystem (git unavailable: not a git repository)',
    });

    expect(result.scanMethod).toContain('filtered-filesystem');
    expect(result.scanMethod).toContain('git unavailable');
  });

  it('detects the Tauri runtime flag', () => {
    const targetWindow = window as NativeRuntimeWindow;
    const original = targetWindow.__TAURI_INTERNALS__;
    delete targetWindow.__TAURI_INTERNALS__;
    expect(isTauriRuntime()).toBe(false);

    targetWindow.__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    if (original === undefined) {
      delete targetWindow.__TAURI_INTERNALS__;
    } else {
      targetWindow.__TAURI_INTERNALS__ = original;
    }
  });
});
