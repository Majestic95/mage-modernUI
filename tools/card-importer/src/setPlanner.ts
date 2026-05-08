import { createSingleCardPlan } from './javaGenerator';
import type { BatchSetPlan, ImportedSet, ImportPlan, RepoScan } from './types';

export function createBatchSetPlan(set: ImportedSet, scan: RepoScan | null): BatchSetPlan {
  const cardPlans = set.cards.map((card) => createSingleCardPlan(card, scan));
  return {
    set,
    cardPlans,
    summary: summarize(cardPlans),
  };
}

function summarize(cardPlans: ImportPlan[]): BatchSetPlan['summary'] {
  return cardPlans.reduce(
    (acc, plan) => {
      switch (plan.classification.difficulty) {
        case 'reprint':
          acc.reprints += 1;
          break;
        case 'simple-stub':
          acc.simpleStubs += 1;
          break;
        case 'known-mechanic':
          acc.knownMechanics += 1;
          break;
        case 'needs-engine-work':
          acc.needsEngineWork += 1;
          break;
      }
      return acc;
    },
    {
      reprints: 0,
      simpleStubs: 0,
      knownMechanics: 0,
      needsEngineWork: 0,
    },
  );
}
