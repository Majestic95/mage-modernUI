import { useState } from 'react';
import { createSingleCardInitSnippet, createSetInitSnippet } from './initSnippet';
import { createSetCompletionReport, type SetCompletionReport } from './setCompletion';
import { createPlanVerificationCommands, type VerificationCommand } from './verificationCommands';
import type { BatchSetPlan, ImportPlan, RepoScan } from './types';

export function VerificationCommandsPanel({ plan }: { plan: ImportPlan | BatchSetPlan }) {
  const commands = createPlanVerificationCommands(plan);
  return (
    <section className="panel">
      <h2>Verification Commands</h2>
      <p className="muted">
        Copy these from the XMage checkout root. They inspect metadata, constructors, and rules text;
        they do not prove gameplay correctness.
      </p>
      <div className="command-list">
        {commands.map((entry) => <VerificationCommandCard key={entry.id} entry={entry} />)}
      </div>
    </section>
  );
}

export function SetCompletionDashboard({ plan, scan }: { plan: BatchSetPlan; scan: RepoScan | null }) {
  const report = createSetCompletionReport(plan, scan);
  return (
    <section className="panel">
      <h2>Set Completion Dashboard</h2>
      <p className="muted">
        Compares fetched Scryfall cards against the scanned checkout and generated proposals.
      </p>
      <CompletionStats report={report} />
      {report.summary.warnings.length > 0 && (
        <>
          <h3>Warnings</h3>
          <ul>
            {report.summary.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="lookup-warning">{warning}</li>)}
          </ul>
        </>
      )}
      <h3>Attention Needed</h3>
      <ul>
        {report.rows
          .filter((row) => !row.hasSetEntry || !row.hasCardClass || row.difficulty === 'needs-engine-work')
          .slice(0, 12)
          .map((row, index) => (
            <li key={`${row.collectorNumber}-${row.cardName}-${index}`}>
              #{row.collectorNumber} {row.cardName}: {describeCompletionRow(row)}
            </li>
          ))}
      </ul>
      {report.rows.every((row) => row.hasSetEntry && row.hasCardClass && row.difficulty !== 'needs-engine-work') && (
        <p className="muted">No missing classes, missing set entries, or engine-work cards in this preview.</p>
      )}
    </section>
  );
}

export function InitSnippetPanel({ plan }: { plan: ImportPlan | BatchSetPlan }) {
  const snippet = 'cardPlans' in plan ? createSetInitSnippet(plan) : createSingleCardInitSnippet(plan);
  return (
    <section className="panel">
      <h2>Manual Test Mode Snippet</h2>
      <p className="muted">
        Starter `init.txt` group for XMage server test mode. It sets up lands and puts cards in hand;
        use it only as manual smoke-test setup.
      </p>
      <CopyableBlock value={snippet} label="Copy init.txt snippet" className="snippet-box" />
    </section>
  );
}

function VerificationCommandCard({ entry }: { entry: VerificationCommand }) {
  return (
    <article className="command-card">
      <div className="command-heading">
        <h3>{entry.label}</h3>
        <span>{entry.scope} · {entry.cost}</span>
      </div>
      <p>{entry.description}</p>
      <CopyableBlock value={entry.command} label="Copy command" />
      <dl>
        <dt>Proves</dt>
        <dd>{entry.proves}</dd>
        <dt>Caveat</dt>
        <dd>{entry.caveat}</dd>
      </dl>
    </article>
  );
}

function CompletionStats({ report }: { report: SetCompletionReport }) {
  const stats = [
    ['Fetched cards', report.summary.totalCards],
    ['Present set entries', report.summary.presentSetEntries],
    ['Missing set entries', report.summary.missingSetEntries],
    ['Missing classes', report.summary.missingCardClasses],
    ['Class exists, entry missing', report.summary.classExistsMissingSetEntry],
    ['Reprints', report.summary.reprints],
    ['Needs engine work', report.summary.needsEngineWork],
    ['Token proposal cards', report.summary.tokenProposalCards],
    ['Image proposal cards', report.summary.imageProposalCards],
  ] as const;
  return (
    <div className="stat-grid">
      {stats.map(([label, value]) => (
        <div className="stat-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function CopyableBlock({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
      window.alert('Copy failed. Select the text and copy it manually.');
    }
  }
  return (
    <div className="copyable-block">
      <pre className={className}><code>{value}</code></pre>
      <button type="button" className="copy-button" onClick={() => void copy()}>
        {copied ? 'Copied' : label}
      </button>
    </div>
  );
}

function describeCompletionRow(row: SetCompletionReport['rows'][number]): string {
  const issues: string[] = [];
  if (!row.hasCardClass) issues.push('missing card class');
  if (!row.hasSetEntry) issues.push('missing set entry');
  if (row.difficulty === 'needs-engine-work') issues.push('needs engine work');
  if (row.hasTokenProposal) issues.push('token proposal');
  if (row.hasImageProposal) issues.push('image proposal');
  return issues.join(', ') || 'present';
}
