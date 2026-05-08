import type { GeneratedChange, ImportPlan } from './types';

export function createPatchPreview(plan: ImportPlan): string {
  return plan.changes.map(renderChange).join('\n\n');
}

export function renderChange(change: GeneratedChange): string {
  const escaped = change.content.endsWith('\n') ? change.content : `${change.content}\n`;
  if (isInsertionChange(change)) {
    return [
      `# ${change.title}`,
      `# Insert into: ${change.path}`,
      '# Informational preview only; this is not a git-apply patch.',
      escaped,
    ].join('\n');
  }
  return [
    `diff --git a/${change.path} b/${change.path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${change.path}`,
    ...escaped.split('\n').map((line) => `+${line}`),
  ].join('\n');
}

function isInsertionChange(change: GeneratedChange): boolean {
  return change.kind === 'set-entry'
    || change.kind === 'token-database'
    || change.kind === 'image-support';
}
