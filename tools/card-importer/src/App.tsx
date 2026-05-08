import { useEffect, useMemo, useState } from 'react';
import {
  createCheckoutSearchIndex,
  searchCardInCheckout,
  searchCardInSet,
  searchSetInCheckout,
  type CardSearchResult,
  type CheckoutSearchIndex,
  type SetSearchResult,
} from './checkoutSearch';
import { createSingleCardPlan } from './javaGenerator';
import { isTauriRuntime, pickAndScanNativeRepo } from './nativeRepoScanner';
import { createPatchPreview } from './patch';
import { createBrowserFileProvider, scanRepo } from './repoScanner';
import { fetchCardByName, fetchSetByCode } from './scryfallClient';
import type { BatchSetPlan, ImportPlan, ImportedCard, ImportedSet, RepoScan } from './types';
import { createBatchSetPlan } from './setPlanner';
import { InitSnippetPanel, SetCompletionDashboard, VerificationCommandsPanel } from './workflowPanels';

type Mode = 'card' | 'set';
type CheckoutSearchMode = 'card' | 'set' | 'card-set';

export function App() {
  const [mode, setMode] = useState<Mode>('card');
  const [cardName, setCardName] = useState('Lightning Bolt');
  const [setCode, setSetCode] = useState('FDN');
  const [checkoutSearchMode, setCheckoutSearchMode] = useState<CheckoutSearchMode>('card-set');
  const [checkoutCardQuery, setCheckoutCardQuery] = useState('Lightning Bolt');
  const [checkoutSetQuery, setCheckoutSetQuery] = useState('FDN');
  const debouncedCheckoutCardQuery = useDebouncedValue(checkoutCardQuery, 150);
  const debouncedCheckoutSetQuery = useDebouncedValue(checkoutSetQuery, 150);
  const [scan, setScan] = useState<RepoScan | null>(null);
  const nativeAvailable = isTauriRuntime();
  const [singlePlan, setSinglePlan] = useState<ImportPlan | null>(null);
  const [batchPlan, setBatchPlan] = useState<BatchSetPlan | null>(null);
  const [status, setStatus] = useState('Select a repo folder, then fetch a card or set.');
  const [busy, setBusy] = useState(false);

  const patchPreview = useMemo(() => {
    if (singlePlan) return createPatchPreview(singlePlan);
    if (batchPlan) {
      return batchPlan.cardPlans.map(createPatchPreview).join('\n\n');
    }
    return '';
  }, [singlePlan, batchPlan]);
  const checkoutIndex = useMemo(() => scan ? createCheckoutSearchIndex(scan) : null, [scan]);

  async function onRepoSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatus('Scanning selected XMage checkout...');
    try {
      const provider = createBrowserFileProvider(files);
      const repoScan = await scanRepo('selected-browser-folder', provider);
      setScan(repoScan);
      setStatus(
        `Scanned ${repoScan.cardClasses.size} card classes, ${repoScan.setEntries.length} set entries, ${repoScan.tokenEntries.length} token rows.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Repo scan failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onNativeRepoPick() {
    setBusy(true);
    setStatus('Opening native folder picker...');
    try {
      const result = await pickAndScanNativeRepo();
      if (!result) {
        setStatus('Repo selection cancelled.');
        return;
      }
      setScan(result.scan);
      setStatus(
        `Scanned ${result.scan.cardClasses.size} card classes, ${result.scan.setEntries.length} set entries, ${result.scan.tokenEntries.length} token rows via ${result.scanMethod}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Native repo scan failed.');
    } finally {
      setBusy(false);
    }
  }

  async function generateCardPlan() {
    setBusy(true);
    setStatus('Fetching card from Scryfall...');
    setSinglePlan(null);
    setBatchPlan(null);
    try {
      const card = await fetchCardByName(cardName, setCode);
      const plan = createSingleCardPlan(card, scan);
      setSinglePlan(plan);
      setStatus(`Generated ${card.name} (${card.setCode} #${card.collectorNumber}) preview.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Card generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function generateSetPlan() {
    setBusy(true);
    setStatus('Fetching set from Scryfall...');
    setSinglePlan(null);
    setBatchPlan(null);
    try {
      const set = await fetchSetByCode(setCode);
      setBatchPlan(createBatchSetPlan(set, scan));
      setStatus(`Generated batch preview for ${set.name} (${set.code}).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Set generation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">XMage developer tooling</p>
          <h1>Card Importer Workbench</h1>
          <p>
            Fetch official card data, scan a local XMage checkout, classify import
            difficulty, and generate reviewable patch previews.
          </p>
        </div>
        <span className="safety-badge">Preview-only by default</span>
      </header>

      <section className="panel">
        <h2>1. Select XMage Checkout</h2>
        <p className="muted">
          Desktop builds use a native folder picker and scan only the XMage files needed.
          Browser builds keep a local fallback picker; the browser may call it an upload,
          but files stay on your machine.
        </p>
        {nativeAvailable && (
          <button type="button" disabled={busy} onClick={() => void onNativeRepoPick()}>
            Choose repo folder
          </button>
        )}
        {!nativeAvailable && (
          <div className="browser-fallback">
            <p className="muted">
              Browser fallback: select the repo folder only if you are not running the Tauri app.
              The browser may enumerate many files before this tool can filter them.
            </p>
            <input
              type="file"
              webkitdirectory=""
              multiple
              onChange={(event) => void onRepoSelected(event.currentTarget.files)}
            />
          </div>
        )}
      </section>

      <section className="panel controls">
        <h2>2. Generate Import Preview</h2>
        <div className="mode-row">
          <button type="button" className={mode === 'card' ? 'active' : ''} onClick={() => setMode('card')}>
            One card
          </button>
          <button type="button" className={mode === 'set' ? 'active' : ''} onClick={() => setMode('set')}>
            Whole set
          </button>
        </div>
        {mode === 'card' && (
          <label>
            Card name
            <input value={cardName} onChange={(event) => setCardName(event.target.value)} />
          </label>
        )}
        <label>
          Set code
          <input value={setCode} onChange={(event) => setSetCode(event.target.value.toUpperCase())} />
        </label>
        <button type="button" disabled={busy} onClick={() => void (mode === 'card' ? generateCardPlan() : generateSetPlan())}>
          {busy ? 'Working...' : 'Generate preview'}
        </button>
        <p role="status" className="status">{status}</p>
      </section>

      <section className="panel controls">
        <h2>3. Search Selected Checkout</h2>
        <p className="muted">
          Search the scanned local XMage files without generating changes. Select a checkout first.
        </p>
        <div className="mode-row">
          <button type="button" className={checkoutSearchMode === 'card' ? 'active' : ''} onClick={() => setCheckoutSearchMode('card')}>
            Card
          </button>
          <button type="button" className={checkoutSearchMode === 'set' ? 'active' : ''} onClick={() => setCheckoutSearchMode('set')}>
            Set
          </button>
          <button type="button" className={checkoutSearchMode === 'card-set' ? 'active' : ''} onClick={() => setCheckoutSearchMode('card-set')}>
            Card + set
          </button>
        </div>
        {checkoutSearchMode !== 'set' && (
          <label>
            Card name
            <input value={checkoutCardQuery} onChange={(event) => setCheckoutCardQuery(event.target.value)} />
          </label>
        )}
        {checkoutSearchMode !== 'card' && (
          <label>
            Set code
            <input value={checkoutSetQuery} onChange={(event) => setCheckoutSetQuery(event.target.value.toUpperCase())} />
          </label>
        )}
        <CheckoutSearchResult
          mode={checkoutSearchMode}
          cardQuery={debouncedCheckoutCardQuery}
          setQuery={debouncedCheckoutSetQuery}
          index={checkoutIndex}
        />
      </section>

      {(singlePlan || batchPlan) && (
        <section className="grid">
          {singlePlan && <SourceCard card={singlePlan.card} />}
          {singlePlan && <ClassificationCard plan={singlePlan} />}
          {batchPlan && <BatchSummary set={batchPlan.set} plan={batchPlan} />}
        </section>
      )}

      {singlePlan && (
        <>
          <VerificationCommandsPanel plan={singlePlan} />
          <InitSnippetPanel plan={singlePlan} />
        </>
      )}

      {batchPlan && (
        <>
          <SetCompletionDashboard plan={batchPlan} scan={scan} />
          <VerificationCommandsPanel plan={batchPlan} />
          <InitSnippetPanel plan={batchPlan} />
        </>
      )}

      {(singlePlan || batchPlan) && (
        <section className="panel">
          <h2>Patch Preview</h2>
          <textarea readOnly value={patchPreview} className="patch-box" />
        </section>
      )}
    </main>
  );
}

function CheckoutSearchResult({
  mode,
  cardQuery,
  setQuery,
  index,
}: {
  mode: CheckoutSearchMode;
  cardQuery: string;
  setQuery: string;
  index: CheckoutSearchIndex | null;
}) {
  if (!index) {
    return <p className="status">Select an XMage checkout before searching local files.</p>;
  }

  if (mode === 'card') {
    if (cardQuery.trim().length === 0) {
      return <p className="status">Type a card name to search.</p>;
    }
    const result = searchCardInCheckout(index, cardQuery);
    return (
      <div className="lookup-result">
        <p className={lookupHeadlineClass(result.classExists, result.warnings.length > 0)}>
          {result.classExists ? 'Card class found.' : 'Card class not found.'}
        </p>
        <NoteList notes={[...result.notes, ...result.warnings]} warningCount={result.warnings.length} />
        <dl>
          <dt>Expected class</dt>
          <dd>{result.identity.className}</dd>
          <dt>{result.classExists ? 'Class path' : 'Expected class path'}</dt>
          <dd className={result.classExists ? undefined : 'lookup-expected'}>
            <PathValue path={result.classPath ?? result.expectedClassPath} />
          </dd>
          <dt>Registered entries</dt>
          <dd>{result.setEntries.length}</dd>
        </dl>
        <SetEntryList entries={result.setEntries} />
      </div>
    );
  }

  if (mode === 'set') {
    if (setQuery.trim().length === 0) {
      return <p className="status">Type a set code to search.</p>;
    }
    const result = searchSetInCheckout(index, setQuery);
    return (
      <div className="lookup-result">
        <p className={result.exists ? 'lookup-positive' : 'lookup-negative'}>
          {result.exists ? `${result.setName ?? result.normalizedCode} exists locally.` : 'Set class not found in scanned files.'}
        </p>
        <dl>
          <dt>Set code</dt>
          <dd>{result.normalizedCode}</dd>
          <dt>Set class</dt>
          <dd>{result.setClassName}</dd>
          <dt>{result.exists ? 'Set path' : 'Expected set path'}</dt>
          <dd className={result.exists ? undefined : 'lookup-expected'}>
            <PathValue path={result.setPath} />
          </dd>
          <dt>Registered entries (printings)</dt>
          <dd>{result.entries.length}</dd>
          <dt>Unique card classes</dt>
          <dd>{result.uniqueCardCount}</dd>
        </dl>
      </div>
    );
  }

  if (cardQuery.trim().length === 0 || setQuery.trim().length === 0) {
    return <p className="status">Type both a card name and set code to search.</p>;
  }
  const result = searchCardInSet(index, cardQuery, setQuery);
  const matchingCollectorNumbers = result.matchingEntries.map((entry) => `#${entry.collectorNumber}`).join(', ');
  return (
    <div className="lookup-result">
      <p className={lookupHeadlineClass(result.status === 'card-and-set-entry-exist', result.card.warnings.length > 0)}>
        {describeCardInSetStatus(result.status)}
      </p>
      {matchingCollectorNumbers && <p className="lookup-collector">Matching collector numbers: {matchingCollectorNumbers}</p>}
      <NoteList notes={[...result.card.notes, ...result.card.warnings]} warningCount={result.card.warnings.length} />
      <dl>
        <dt>Expected class</dt>
        <dd>{result.card.identity.className}</dd>
        <dt>{result.card.classExists ? 'Class path' : 'Expected class path'}</dt>
        <dd className={result.card.classExists ? undefined : 'lookup-expected'}>
          <PathValue path={result.card.classPath ?? result.card.expectedClassPath} />
        </dd>
        <dt>{result.set.exists ? 'Set path' : 'Expected set path'}</dt>
        <dd className={result.set.exists ? undefined : 'lookup-expected'}>
          <PathValue path={result.set.setPath} />
        </dd>
        <dt>Matching set entries</dt>
        <dd>{result.matchingEntries.length}</dd>
      </dl>
      <SetEntryList entries={result.matchingEntries} />
    </div>
  );
}

function describeCardInSetStatus(status: ReturnType<typeof searchCardInSet>['status']): string {
  switch (status) {
    case 'card-and-set-entry-exist':
      return 'Card class and set entry both exist locally.';
    case 'class-exists-missing-set-entry':
      return 'Card class exists, but this set is missing the card entry.';
    case 'set-exists-card-class-and-entry-missing':
      return 'Set exists, but this card has no scanned class file and no entry in that set.';
    case 'set-missing':
      return 'Set class was not found in scanned files.';
    case 'card-missing':
      return 'Card class was not found locally.';
    case 'empty-query':
      return 'Type both a card name and set code to search.';
  }
}

function SetEntryList({ entries }: { entries: CardSearchResult['setEntries'] }) {
  if (entries.length === 0) return null;
  return (
    <>
      <h3>Matching Set Entries</h3>
      <ul>
        {entries.slice(0, 10).map((entry, index) => (
          <li key={`${entry.setCode}-${entry.collectorNumber}-${entry.className}-${index}`}>
            {entry.setCode} #{entry.collectorNumber}: {entry.cardName} in {entry.setClassName}
          </li>
        ))}
      </ul>
      {entries.length > 10 && <p className="muted">Showing first 10 of {entries.length} entries.</p>}
    </>
  );
}

function NoteList({ notes, warningCount = 0 }: { notes: string[]; warningCount?: number }) {
  if (notes.length === 0) return null;
  return (
    <>
      <h3>Notes</h3>
      <ul>
        {notes.map((note, index) => (
          <li key={note} className={index >= notes.length - warningCount ? 'lookup-warning' : undefined}>
            {note}
          </li>
        ))}
      </ul>
    </>
  );
}

function PathValue({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="path-value">
      <code>{path}</code>
      <button type="button" className="copy-button" onClick={() => void copyPath()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

function lookupHeadlineClass(isPositive: boolean, hasWarning: boolean): string {
  if (hasWarning) return 'lookup-warning';
  return isPositive ? 'lookup-positive' : 'lookup-negative';
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) setDebounced(value);
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [value, delayMs]);

  return debounced;
}

function SourceCard({ card }: { card: ImportedCard }) {
  return (
    <article className="panel">
      <h2>{card.name}</h2>
      <dl>
        <dt>Set</dt>
        <dd>{card.setCode} #{card.collectorNumber}</dd>
        <dt>Type</dt>
        <dd>{card.typeLine || 'No type line'}</dd>
        <dt>Mana</dt>
        <dd>{card.manaCost || 'None'}</dd>
        <dt>Oracle</dt>
        <dd className="oracle">{card.oracleText || 'No rules text'}</dd>
      </dl>
    </article>
  );
}

function ClassificationCard({ plan }: { plan: ImportPlan }) {
  return (
    <article className="panel">
      <h2>Classification</h2>
      <p className="difficulty">{plan.classification.difficulty}</p>
      <p>Confidence: {plan.classification.confidence}</p>
      <ul>
        {plan.classification.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        {plan.classification.issues.map((issue) => (
          <li key={`${issue.title}-${issue.detail}`}>{issue.title}: {issue.detail}</li>
        ))}
      </ul>
    </article>
  );
}

function BatchSummary({ set, plan }: { set: ImportedSet; plan: BatchSetPlan }) {
  const firstFive = useMemo(() => plan.cardPlans.slice(0, 5), [plan.cardPlans]);
  return (
    <article className="panel">
      <h2>{set.name} Summary</h2>
      <p>{set.cards.length} cards fetched.</p>
      <ul>
        <li>Reprints: {plan.summary.reprints}</li>
        <li>Simple stubs: {plan.summary.simpleStubs}</li>
        <li>Known mechanics: {plan.summary.knownMechanics}</li>
        <li>Needs engine work: {plan.summary.needsEngineWork}</li>
      </ul>
      <h3>First cards</h3>
      <ul>
        {firstFive.map((cardPlan) => (
          <li key={`${cardPlan.card.name}-${cardPlan.card.collectorNumber}`}>
            {cardPlan.card.name}: {cardPlan.classification.difficulty}
          </li>
        ))}
      </ul>
    </article>
  );
}
