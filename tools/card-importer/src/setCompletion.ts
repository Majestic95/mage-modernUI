import type { BatchSetPlan, ImportPlan, RepoScan } from './types';
import { getCardIdentity, isCoreBasicLand } from './xmageNaming';

export interface SetCompletionSummary {
  totalCards: number;
  presentSetEntries: number;
  missingSetEntries: number;
  missingCardClasses: number;
  classExistsMissingSetEntry: number;
  reprints: number;
  needsEngineWork: number;
  tokenProposalCards: number;
  imageProposalCards: number;
  warnings: string[];
}

export interface CardCompletionRow {
  cardName: string;
  collectorNumber: string;
  difficulty: ImportPlan['classification']['difficulty'];
  hasSetEntry: boolean;
  hasCardClass: boolean;
  hasTokenProposal: boolean;
  hasImageProposal: boolean;
}

export interface SetCompletionReport {
  summary: SetCompletionSummary;
  rows: CardCompletionRow[];
}

export function createSetCompletionReport(plan: BatchSetPlan, scan: RepoScan | null): SetCompletionReport {
  const rows = plan.cardPlans.map((cardPlan) => createCardCompletionRow(cardPlan, scan));
  const missingSetEntries = rows.filter((row) => !row.hasSetEntry).length;
  const missingCardClasses = rows.filter((row) => !row.hasCardClass).length;
  const classExistsMissingSetEntry = rows.filter((row) => row.hasCardClass && !row.hasSetEntry).length;
  const tokenProposalCards = rows.filter((row) => row.hasTokenProposal).length;
  const imageProposalCards = rows.filter((row) => row.hasImageProposal).length;
  const warnings: string[] = [];

  if (missingSetEntries > 0) {
    warnings.push(`${missingSetEntries} Scryfall cards do not have matching scanned set entries.`);
  }
  if (missingCardClasses > 0) {
    warnings.push(`${missingCardClasses} cards do not have matching scanned class files.`);
  }
  if (plan.summary.needsEngineWork > 0) {
    warnings.push(`${plan.summary.needsEngineWork} cards are classified as needing human engine work.`);
  }
  if (tokenProposalCards > 0 || imageProposalCards > 0) {
    warnings.push('Token and image counts are generated proposals, not verified missing database rows.');
  }

  return {
    summary: {
      totalCards: rows.length,
      presentSetEntries: rows.length - missingSetEntries,
      missingSetEntries,
      missingCardClasses,
      classExistsMissingSetEntry,
      reprints: plan.summary.reprints,
      needsEngineWork: plan.summary.needsEngineWork,
      tokenProposalCards,
      imageProposalCards,
      warnings,
    },
    rows,
  };
}

function createCardCompletionRow(plan: ImportPlan, scan: RepoScan | null): CardCompletionRow {
  const identity = getCardIdentity(plan.card.name);
  const normalizedSetCode = plan.card.setCode.trim().toUpperCase();
  const hasSetEntry = scan?.setEntries.some((entry) => (
    entry.setCode.trim().toUpperCase() === normalizedSetCode
    && (entry.className === identity.className || sameName(entry.cardName, plan.card.name))
  )) ?? false;
  const hasCardClass = isCoreBasicLand(plan.card.name) || (scan?.cardClasses.has(identity.className) ?? false);
  return {
    cardName: plan.card.name,
    collectorNumber: plan.card.collectorNumber,
    difficulty: plan.classification.difficulty,
    hasSetEntry,
    hasCardClass,
    hasTokenProposal: plan.changes.some((change) => change.kind === 'token-database'),
    hasImageProposal: plan.changes.some((change) => change.kind === 'image-support'),
  };
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
