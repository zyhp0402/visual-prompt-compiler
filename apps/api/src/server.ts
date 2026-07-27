import { buildApp } from './app.js';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 8787);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('API_PORT must be an integer between 1 and 65535');
}

const app = buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
