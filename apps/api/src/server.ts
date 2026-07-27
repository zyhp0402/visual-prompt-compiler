import { createOpenAIPlanner } from '@vpc/openai-adapter';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({
  config,
  plannerFactory: () =>
    createOpenAIPlanner({
      apiKey: config.apiKey,
      model: config.textModel,
      timeoutMs: config.timeoutMs,
    }),
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error({ event: 'listen_failed' }, 'server failed to start');
  process.exitCode = 1;
}
