import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  EvalError,
  executeEvaluation,
  finalizeEvaluationRun,
  type EvalMode,
} from './index.js';

const valueAfter = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const mode = valueAfter(args, '--mode');
  if (mode !== 'mock' && mode !== 'real') {
    throw new EvalError('EVAL_INVALID_CASE', 'Use --mode mock or --mode real.');
  }
  const input = resolve(
    valueAfter(args, '--input') ?? 'fixtures/benchmark-cases.jsonl',
  );
  const outDir = resolve(valueAfter(args, '--out-dir') ?? 'artifacts/evals');
  const runId =
    valueAfter(args, '--run-id') ??
    `${mode}-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const now = valueAfter(args, '--now') ?? new Date().toISOString();

  const report = await executeEvaluation({
    mode: mode as EvalMode,
    source: mode === 'mock' ? await readFile(input, 'utf8') : undefined,
    runId,
    now,
    env: process.env,
    readSource: () => readFile(input, 'utf8'),
  });
  await finalizeEvaluationRun(report, outDir, undefined, (paths) =>
    process.stdout.write(
      `Evaluation complete: ${report.records.length} records\n${paths.jsonPath}\n${paths.markdownPath}\n`,
    ),
  );
};

main().catch((error: unknown) => {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : 'EVAL_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
