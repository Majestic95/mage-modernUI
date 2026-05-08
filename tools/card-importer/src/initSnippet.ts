import type { BatchSetPlan, ImportPlan, ImportedCard } from './types';

const STARTING_LANDS = [
  'battlefield:Human:Plains:5',
  'battlefield:Human:Island:5',
  'battlefield:Human:Swamp:5',
  'battlefield:Human:Mountain:5',
  'battlefield:Human:Forest:5',
];

export function createSingleCardInitSnippet(plan: ImportPlan): string {
  return createSnippet([plan.card], `${normalizeSetCode(plan.card.setCode)}-${plan.identity.className}`);
}

export function createSetInitSnippet(plan: BatchSetPlan): string {
  const sampleCards = plan.cardPlans
    .filter((cardPlan) => cardPlan.classification.difficulty !== 'reprint')
    .slice(0, 10)
    .map((cardPlan) => cardPlan.card);
  const cards = sampleCards.length > 0 ? sampleCards : plan.cardPlans.slice(0, 10).map((cardPlan) => cardPlan.card);
  return createSnippet(cards, `${normalizeSetCode(plan.set.code)}-sample`);
}

function createSnippet(cards: ImportedCard[], groupName: string): string {
  const handLines = cards.map((card) => `hand:Human:${formatSetQualifiedName(card)}:1`);
  return [
    '// Starter smoke-test snippet for XMage server test mode.',
    '// Add this group to Mage.Server/config/init.txt or release mage-server/config/init.txt.',
    '// It only sets up a quick manual test; it does not prove gameplay correctness.',
    '',
    `[${groupName}]`,
    ...STARTING_LANDS,
    ...handLines,
  ].join('\n');
}

function formatSetQualifiedName(card: ImportedCard): string {
  const setCode = normalizeSetCode(card.setCode);
  return setCode ? `${setCode}-${card.name}` : card.name;
}

function normalizeSetCode(setCode: string): string {
  return setCode.trim().toUpperCase();
}
