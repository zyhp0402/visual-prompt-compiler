import Fastify, { type FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: {
              status: { const: 'ok' },
            },
          },
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  return app;
}
