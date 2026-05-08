import { describe, expect, it } from 'vitest';
import { renderChange } from './patch';
import type { GeneratedChange } from './types';

describe('patch preview', () => {
  it('renders existing-file insertions as informational snippets', () => {
    const change: GeneratedChange = {
      kind: 'token-database',
      path: 'Mage/src/main/resources/tokens-database.txt',
      title: 'Token database proposals',
      content: '|TOK:TST|Goblin||GoblinToken|',
      applied: false,
    };
    const rendered = renderChange(change);
    expect(rendered).toContain('# Insert into: Mage/src/main/resources/tokens-database.txt');
    expect(rendered).toContain('# Informational preview only; this is not a git-apply patch.');
    expect(rendered).not.toContain('new file mode 100644');
  });

  it('preserves blank lines for new-file diffs', () => {
    const change: GeneratedChange = {
      kind: 'checklist',
      path: 'generated/checklist.md',
      title: 'Checklist',
      content: 'one\n\ntwo\n',
      applied: false,
    };
    expect(renderChange(change)).toContain('+one\n+\n+two\n+');
  });
});
