import { extractUnmappedRulesText, isKnownKeyword, isParameterizedKeyword } from './mechanics';
import type { ImportClassification, ImportedCard, RepoScan } from './types';
import { getCardIdentity, isCoreBasicLand, toXmageClassName } from './xmageNaming';

export function classifyImport(card: ImportedCard, scan: RepoScan | null): ImportClassification {
  const identity = getCardIdentity(card.name);
  const reasons: string[] = [];
  const issues: ImportClassification['issues'] = [];
  const existingClass = scan?.cardClasses.get(identity.className);
  const parameterizedKeywords = card.keywords.filter(isParameterizedKeyword);
  const nonIntegerFields = findNonIntegerStats(card);

  if (existingClass) {
    reasons.push(`Existing card class found at ${existingClass.classPath}.`);
    return {
      difficulty: 'reprint',
      confidence: 'high',
      reasons,
      issues,
    };
  }

  if (isCoreBasicLand(card.name)) {
    issues.push({
      severity: 'warning',
      title: 'Core basic land class already lives in Mage',
      detail: `${card.name} should usually be added as a set reprint, not regenerated as a new card class.`,
    });
  }

  const unknownKeywords = card.keywords.filter((keyword) => !isKnownKeyword(keyword) && !isParameterizedKeyword(keyword));
  const unmappedRules = extractUnmappedRulesText(card.oracleText, card.keywords);

  if (toXmageClassName(card.name) !== card.name.replace(/\s*\/\/\s*/g, '').replace(/[-\s',]/g, '')) {
    issues.push({
      severity: 'info',
      title: 'Card name was normalized for Java',
      detail: `Generated class name: ${identity.className}. Review non-ASCII punctuation and official XMage naming before applying.`,
    });
  }

  if (parameterizedKeywords.length > 0) {
    issues.push({
      severity: 'warning',
      title: 'Parameterized keyword mechanics',
      detail: `Needs human rules work because keyword values vary by card: ${parameterizedKeywords.join(', ')}.`,
    });
  }

  for (const field of nonIntegerFields) {
    issues.push({
      severity: 'warning',
      title: 'Non-integer stat value',
      detail: `${field.label} is "${field.value}" and must be implemented by custom XMage code.`,
    });
  }

  if (unknownKeywords.length > 0) {
    issues.push({
      severity: 'warning',
      title: 'Unknown keyword mechanics',
      detail: `Needs human rules work: ${unknownKeywords.join(', ')}.`,
    });
  }

  if (unmappedRules.length > 0) {
    issues.push({
      severity: 'warning',
      title: 'Oracle text needs manual mapping',
      detail: unmappedRules.join('\n'),
    });
  }

  if (card.layout !== 'normal' && card.layout !== 'token') {
    issues.push({
      severity: 'warning',
      title: 'Complex card layout',
      detail: `${card.layout} cards often need hand-written XMage code.`,
    });
  }

  if (
    isCoreBasicLand(card.name)
    || parameterizedKeywords.length > 0
    || nonIntegerFields.length > 0
    || unknownKeywords.length > 0
    || unmappedRules.length > 0
    || card.layout !== 'normal'
  ) {
    reasons.push('Some rules text cannot be safely generated.');
    return {
      difficulty: 'needs-engine-work',
      confidence: 'low',
      reasons,
      issues,
    };
  }

  if (card.keywords.length > 0) {
    reasons.push('All card keywords are known simple XMage mappings.');
    return {
      difficulty: 'known-mechanic',
      confidence: 'medium',
      reasons,
      issues,
    };
  }

  reasons.push('No rules text or unknown mechanics detected.');
  return {
    difficulty: 'simple-stub',
    confidence: 'high',
    reasons,
    issues,
  };
}

function findNonIntegerStats(card: ImportedCard): Array<{ label: string; value: string }> {
  return [
    { label: 'Power', value: card.power },
    { label: 'Toughness', value: card.toughness },
    { label: 'Loyalty', value: card.loyalty },
    { label: 'Defense', value: card.defense },
  ].filter((field): field is { label: string; value: string } => field.value !== null && !/^-?\d+$/.test(field.value));
}
