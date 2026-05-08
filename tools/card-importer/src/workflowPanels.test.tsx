import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InitSnippetPanel, SetCompletionDashboard, VerificationCommandsPanel } from './workflowPanels';
import type { BatchSetPlan, ImportPlan, ImportedCard, RepoScan } from './types';

const card: ImportedCard = {
  name: 'Lightning Bolt',
  setCode: 'FDN',
  collectorNumber: '123',
  rarity: 'common',
  layout: 'normal',
  manaCost: '{R}',
  typeLine: 'Instant',
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  faces: [],
  keywords: [],
  isReprint: false,
  scryfallUri: null,
};

const importPlan: ImportPlan = {
  card,
  identity: {
    cardName: 'LightningBolt',
    className: 'LightningBolt',
    packageLetter: 'l',
    classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
  },
  classification: {
    difficulty: 'simple-stub',
    confidence: 'medium',
    reasons: [],
    issues: [],
  },
  changes: [],
  verificationCommands: [],
};

const batchPlan: BatchSetPlan = {
  set: {
    code: 'FDN',
    name: 'Foundations',
    releaseDate: '2024-11-15',
    setType: 'expansion',
    cards: [card],
  },
  cardPlans: [
    {
      ...importPlan,
      changes: [
        {
          kind: 'set-entry',
          path: 'Mage.Sets/src/mage/sets/Foundations.java',
          title: 'Set entry',
          content: '',
          applied: false,
        },
      ],
    },
  ],
  summary: {
    reprints: 0,
    simpleStubs: 1,
    knownMechanics: 0,
    needsEngineWork: 0,
  },
};

const scan: RepoScan = {
  rootPath: 'fixture',
  cardClasses: new Map(),
  setClasses: new Map(),
  setEntries: [],
  tokenEntries: [],
  imageSupportEntries: [],
};

describe('workflowPanels', () => {
  it('renders copyable verification commands with caveats', () => {
    render(<VerificationCommandsPanel plan={importPlan} />);

    expect(screen.getByText('Verification Commands')).toBeInTheDocument();
    expect(screen.getByText('Show generated rules text for Lightning Bolt')).toBeInTheDocument();
    expect(screen.getByText(/VerifyCardDataTest#test_showCardInfo/)).toBeInTheDocument();
    expect(screen.getByText(/does not prove gameplay correctness/i)).toBeInTheDocument();
  });

  it('renders set completion stats and warnings', () => {
    render(<SetCompletionDashboard plan={batchPlan} scan={scan} />);

    expect(screen.getByText('Set Completion Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Missing set entries')).toBeInTheDocument();
    expect(screen.getByText(/Scryfall cards do not have matching scanned set entries/)).toBeInTheDocument();
  });

  it('renders init.txt smoke-test snippets', () => {
    render(<InitSnippetPanel plan={importPlan} />);

    expect(screen.getByText('Manual Test Mode Snippet')).toBeInTheDocument();
    expect(screen.getByText(/battlefield:Human:Plains:5/)).toBeInTheDocument();
    expect(screen.getByText(/hand:Human:FDN-Lightning Bolt:1/)).toBeInTheDocument();
  });

  it('shows clipboard failure feedback', async () => {
    const originalClipboard = navigator.clipboard;
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });

    render(<VerificationCommandsPanel plan={importPlan} />);
    screen.getAllByRole('button', { name: 'Copy command' })[0]?.click();

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Copy failed. Select the text and copy it manually.'));

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    alert.mockRestore();
  });
});
