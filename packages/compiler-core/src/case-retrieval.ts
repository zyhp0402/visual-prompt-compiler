import { createHash } from 'node:crypto';

import {
  CasePatternSchema,
  type CasePattern,
  type CompileRequest,
} from '@vpc/contracts';

export type RetrievalStrength = 'low' | 'medium' | 'high';

export type RetrievalConfig = {
  enabled: boolean;
  strength: RetrievalStrength;
};

export type RetrievedCasePattern = {
  id: string;
  license: string;
  patternSummary: string;
  score: number;
};

export type CaseImportErrorCode =
  | 'CASE_INVALID'
  | 'CASE_RIGHTS_NOT_APPROVED'
  | 'CASE_LICENSE_NOT_ALLOWED'
  | 'CASE_HASH_MISMATCH'
  | 'CASE_DUPLICATE_CONTENT'
  | 'CASE_ID_CONFLICT';

export type CaseImportReport = {
  cases: CasePattern[];
  rejected: Array<{
    index: number;
    id?: string;
    code: CaseImportErrorCode;
  }>;
};

const allowedLicenses = new Set(['CC0-1.0', 'CC-BY-4.0']);

type CaseHashInput =
  Omit<CasePattern, 'contentHash' | 'importedAt'> | CasePattern;

const normalizeString = (value: string): string => value.normalize('NFKC');
const normalizeStrings = (values: string[]): string[] =>
  values.map(normalizeString);

const contentFields = (value: CaseHashInput) => ({
  taskType: value.taskType,
  designGoal: normalizeString(value.designGoal),
  visualStructure: normalizeStrings(value.visualStructure),
  designPatterns: normalizeStrings(value.designPatterns),
  successFactors: normalizeStrings(value.successFactors),
  failureRisks: normalizeStrings(value.failureRisks),
  applicability: normalizeStrings(value.applicability),
  patternSummary: normalizeString(value.patternSummary),
  sourceName: normalizeString(value.sourceName),
  sourceUrl: normalizeString(value.sourceUrl),
  license: normalizeString(value.license),
  attribution: normalizeString(value.attribution),
  rightsStatus: value.rightsStatus,
});

export const computeCaseContentHash = (value: CaseHashInput): string =>
  `sha256:${createHash('sha256')
    .update(JSON.stringify(contentFields(value)), 'utf8')
    .digest('hex')}`;

const importError = (
  parsed: ReturnType<typeof CasePatternSchema.safeParse>,
): CaseImportErrorCode => {
  if (!parsed.success) return 'CASE_INVALID';
  if (parsed.data.rightsStatus !== 'approved')
    return 'CASE_RIGHTS_NOT_APPROVED';
  if (!allowedLicenses.has(parsed.data.license))
    return 'CASE_LICENSE_NOT_ALLOWED';
  return computeCaseContentHash(parsed.data) === parsed.data.contentHash
    ? 'CASE_INVALID'
    : 'CASE_HASH_MISMATCH';
};

export const importCasePatterns = (inputs: unknown[]): CaseImportReport => {
  const cases: CasePattern[] = [];
  const rejected: CaseImportReport['rejected'] = [];
  const ids = new Map<string, string>();
  const hashes = new Set<string>();

  inputs.forEach((input, index) => {
    const parsed = CasePatternSchema.safeParse(input);
    const id =
      typeof input === 'object' &&
      input !== null &&
      'id' in input &&
      typeof input.id === 'string'
        ? input.id
        : undefined;
    if (
      !parsed.success ||
      parsed.data.rightsStatus !== 'approved' ||
      !allowedLicenses.has(parsed.data.license)
    ) {
      rejected.push({
        index,
        ...(id ? { id } : {}),
        code: importError(parsed),
      });
      return;
    }
    const { contentHash } = parsed.data;
    if (computeCaseContentHash(parsed.data) !== contentHash) {
      rejected.push({ index, id: parsed.data.id, code: 'CASE_HASH_MISMATCH' });
      return;
    }
    const previousHash = ids.get(parsed.data.id);
    if (previousHash && previousHash !== contentHash) {
      rejected.push({ index, id: parsed.data.id, code: 'CASE_ID_CONFLICT' });
      return;
    }
    if (hashes.has(contentHash)) {
      rejected.push({
        index,
        id: parsed.data.id,
        code: 'CASE_DUPLICATE_CONTENT',
      });
      return;
    }
    ids.set(parsed.data.id, contentHash);
    hashes.add(contentHash);
    cases.push(parsed.data);
  });

  return { cases, rejected };
};

const grams = (value: string): Set<string> => {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
  const result = new Set<string>();
  if (normalized.length < 3) {
    if (normalized) result.add(normalized);
    return result;
  }
  for (let index = 0; index <= normalized.length - 3; index += 1)
    result.add(normalized.slice(index, index + 3));
  return result;
};

export const ngramJaccard = (left: string, right: string): number => {
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
};

const patternGramSimilarity = (prompt: string, pattern: string): number => {
  const promptGrams = grams(prompt);
  const patternGrams = grams(pattern);
  if (promptGrams.size === 0 || patternGrams.size === 0) return 0;
  let intersection = 0;
  for (const item of patternGrams) {
    if (promptGrams.has(item)) intersection += 1;
  }
  const jaccard =
    intersection / (promptGrams.size + patternGrams.size - intersection);
  const containment = intersection / patternGrams.size;
  return Math.max(jaccard, containment);
};

const retrievalRules: Record<
  RetrievalStrength,
  { topK: number; threshold: number }
> = {
  low: { topK: 1, threshold: 0.18 },
  medium: { topK: 2, threshold: 0.1 },
  high: { topK: 3, threshold: 0.05 },
};

export const retrieveCasePatterns = (
  input: Pick<CompileRequest, 'brief' | 'taskType' | 'mandatoryElements'>,
  cases: CasePattern[],
  config: RetrievalConfig,
): RetrievedCasePattern[] => {
  if (!config.enabled) return [];
  const query = [input.brief, ...input.mandatoryElements].join(' ');
  const rule = retrievalRules[config.strength];
  return cases
    .filter(
      (item) =>
        item.rightsStatus === 'approved' &&
        allowedLicenses.has(item.license) &&
        computeCaseContentHash(item) === item.contentHash,
    )
    .map((item) => {
      const candidate = [
        item.designGoal,
        ...item.designPatterns,
        ...item.applicability,
        item.patternSummary,
      ].join(' ');
      const overlap = ngramJaccard(query, candidate);
      const taskMatch =
        input.taskType !== 'auto' && item.taskType === input.taskType ? 1 : 0;
      return {
        id: item.id,
        license: item.license,
        patternSummary: item.patternSummary,
        score: taskMatch + overlap,
        overlap,
      };
    })
    .filter(({ score, overlap }) => score >= 1 || overlap >= rule.threshold)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .slice(0, rule.topK)
    .map(({ id, license, patternSummary, score }) => ({
      id,
      license,
      patternSummary,
      score,
    }));
};

export type SimilarityFinding = {
  max: number;
  sourceId: string | null;
  flagged: boolean;
};

export const checkPatternSimilarity = (
  prompt: string,
  cases: Pick<RetrievedCasePattern, 'id' | 'patternSummary'>[],
  threshold = 0.72,
): SimilarityFinding => {
  const ranked = cases
    .map(({ id, patternSummary }) => ({
      id,
      similarity: patternGramSimilarity(prompt, patternSummary),
    }))
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const first = ranked[0];
  return {
    max: first?.similarity ?? 0,
    sourceId: first?.id ?? null,
    flagged: (first?.similarity ?? 0) >= threshold,
  };
};
