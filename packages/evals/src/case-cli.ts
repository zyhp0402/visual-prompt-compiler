import { resolve } from 'node:path';

import { runCaseEvaluationFromFiles } from './case-eval.js';

const valueAfter = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const args = process.argv.slice(2);
const runId =
  valueAfter(args, '--run-id') ??
  `cases-mock-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
const now = valueAfter(args, '--now') ?? new Date().toISOString();

try {
  const result = await runCaseEvaluationFromFiles({
    benchmarkPath: resolve(
      valueAfter(args, '--input') ?? 'fixtures/benchmark-cases.jsonl',
    ),
    casePath: resolve(
      valueAfter(args, '--cases') ?? 'fixtures/case-patterns.jsonl',
    ),
    outDir: resolve(valueAfter(args, '--out-dir') ?? 'artifacts/evals'),
    runId,
    now,
  });
  process.stdout.write(
    `Case evaluation complete: ${result.report.records.length} records\n${result.jsonPath}\n${result.markdownPath}\n`,
  );
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'CASE_EVAL_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
