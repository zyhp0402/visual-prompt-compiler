import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_VERSION } from '@vpc/compiler-core';
import { SCHEMA_VERSION } from '@vpc/contracts';

export const EVALUATION_VERSION = 'eval-1';

type Versions = {
  promptVersion: string;
  schemaVersion: string;
  evaluationVersion: string;
};

type Fingerprints = {
  promptFingerprint: string;
  schemaFingerprint: string;
  evaluationFingerprint: string;
};

type Approval = Versions & Fingerprints;

export class VersionApprovalError extends Error {
  constructor(readonly code: 'EVAL_VERSION_DRIFT' | 'EVAL_VERSION_NOT_BUMPED') {
    super(code);
    this.name = 'VersionApprovalError';
  }
}

type VersionIo = {
  read?: () => Promise<string>;
  write?: (content: string) => Promise<void>;
  fingerprints?: () => Promise<Fingerprints>;
  versions?: Versions;
};

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const approvalPath = join(repoRoot, 'packages/evals/approved-versions.json');
const promptSources = [
  join(repoRoot, 'packages/compiler-core/src/index.ts'),
  join(repoRoot, 'packages/openai-adapter/src/index.ts'),
];
const schemaSources = [
  join(repoRoot, 'schemas/visual-spec.schema.json'),
  join(repoRoot, 'schemas/compile-response.schema.json'),
  join(repoRoot, 'packages/contracts/src/index.ts'),
];
const evaluationSources = [
  join(repoRoot, 'packages/evals/src/index.ts'),
  join(repoRoot, 'packages/evals/src/cli.ts'),
  join(repoRoot, 'scripts/eval-real-preflight.mjs'),
];

const fingerprint = async (paths: string[]): Promise<string> => {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(await readFile(path, 'utf8'));
  return `sha256:${hash.digest('hex')}`;
};

const currentFingerprints = async (): Promise<Fingerprints> => ({
  promptFingerprint: await fingerprint(promptSources),
  schemaFingerprint: await fingerprint(schemaSources),
  evaluationFingerprint: await fingerprint(evaluationSources),
});

const defaultVersions = (): Versions => ({
  promptVersion: PROMPT_VERSION,
  schemaVersion: SCHEMA_VERSION,
  evaluationVersion: EVALUATION_VERSION,
});

const currentApproval = async (io: VersionIo): Promise<Approval> => ({
  ...(io.versions ?? defaultVersions()),
  ...(await (io.fingerprints ?? currentFingerprints)()),
});

const parseApproval = (content: string): Approval => {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new VersionApprovalError('EVAL_VERSION_DRIFT');
  }
  const keys: Array<keyof Approval> = [
    'promptVersion',
    'promptFingerprint',
    'schemaVersion',
    'schemaFingerprint',
    'evaluationVersion',
    'evaluationFingerprint',
  ];
  if (
    typeof value !== 'object' ||
    value === null ||
    !keys.every(
      (key) =>
        key in value &&
        typeof (value as Record<string, unknown>)[key] === 'string',
    )
  ) {
    throw new VersionApprovalError('EVAL_VERSION_DRIFT');
  }
  return value as Approval;
};

export const checkApprovedVersions = async (
  io: VersionIo = {},
): Promise<void> => {
  const current = await currentApproval(io);
  const approved = parseApproval(
    await (io.read ?? (() => readFile(approvalPath, 'utf8')))(),
  );
  if (
    (Object.keys(current) as Array<keyof Approval>).some(
      (key) => current[key] !== approved[key],
    )
  ) {
    throw new VersionApprovalError('EVAL_VERSION_DRIFT');
  }
};

export const approveVersions = async (io: VersionIo = {}): Promise<void> => {
  const current = await currentApproval(io);
  const approved = parseApproval(
    await (io.read ?? (() => readFile(approvalPath, 'utf8')))(),
  );
  const boundaries = [
    ['promptVersion', 'promptFingerprint'],
    ['schemaVersion', 'schemaFingerprint'],
    ['evaluationVersion', 'evaluationFingerprint'],
  ] as const;
  if (
    boundaries.some(
      ([version, fingerprintKey]) =>
        current[fingerprintKey] !== approved[fingerprintKey] &&
        current[version] === approved[version],
    )
  ) {
    throw new VersionApprovalError('EVAL_VERSION_NOT_BUMPED');
  }
  const content = `${JSON.stringify(current, null, 2)}\n`;
  await (io.write ?? ((value) => writeFile(approvalPath, value, 'utf8')))(
    content,
  );
};

export const currentVersions = async (): Promise<Approval> =>
  currentApproval({});
