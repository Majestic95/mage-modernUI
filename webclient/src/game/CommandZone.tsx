import type { WebCommandObjectView } from '../api/schemas';

/**
 * Command-zone strip â€” renders any commanders / emblems / dungeons /
 * planes the player has, keyed by upstream UUID. Slice 11 ships the
 * placeholder shape (chip with kind tag + name + tooltip on rules);
 * full card art lookup for the {@code commander} kind lands later
 * alongside the broader card-art initiative.
 */
export function CommandZone({ entries }: { entries: WebCommandObjectView[] }) {
  if (!entries || entries.length === 0) {
    return null;
  }
  return (
    <div
      data-testid="command-zone"
      className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-2"
    >
      <span className="text-xs uppercase tracking-wide text-zinc-500 mr-1">
        Command
      </span>
      {entries.map((entry) => (
        <CommandChip key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function CommandChip({ entry }: { entry: WebCommandObjectView }) {
  const kindStyle =
    entry.kind === 'commander'
      ? 'border-amber-700/60 text-amber-200'
      : entry.kind === 'emblem'
        ? 'border-fuchsia-700/60 text-fuchsia-200'
        : entry.kind === 'dungeon'
          ? 'border-emerald-700/60 text-emerald-200'
          : entry.kind === 'plane'
            ? 'border-sky-700/60 text-sky-200'
            : 'border-zinc-700 text-zinc-200';
  return (
    <span
      data-testid="command-chip"
      data-kind={entry.kind}
      className={`inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs border bg-zinc-900 ${kindStyle}`}
      title={entry.rules.join('\n') || entry.kind}
    >
      <span className="uppercase text-[10px] tracking-wide opacity-70">
        {entry.kind}
      </span>
      <span className="font-medium">{entry.name || '<unknown>'}</span>
    </span>
  );
}
