import process from 'node:process';

if (process.env.RUN_OPENAI_SMOKE !== '1') {
  throw new Error(
    'Set RUN_OPENAI_SMOKE=1 to explicitly enable the real API smoke test.',
  );
}

const response = await globalThis.fetch(
  process.env.API_URL ?? 'http://127.0.0.1:8787/v1/compile',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      brief: '生成一张未来城市海报',
      taskType: 'poster',
      aspectRatio: '3:4',
      mandatoryText: [],
      mandatoryElements: [],
      forbiddenElements: [],
      creativity: 50,
      allowAssumptions: true,
      outputLanguage: 'zh-CN',
    }),
  },
);

if (!response.ok) {
  throw new Error(`Smoke test failed with HTTP ${response.status}`);
}
process.stdout.write('OpenAI compile smoke test passed.\n');
