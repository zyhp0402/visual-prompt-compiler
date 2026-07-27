import process from 'node:process';

const key = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_TEXT_MODEL?.trim();

if (!key || !model) {
  process.stderr.write('EVAL_REAL_CREDENTIALS_MISSING\n');
  process.exitCode = 1;
}
