import { readFileSync } from 'node:fs';

import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const schemaFiles = [
  'visual-spec.schema.json',
  'compile-request.schema.json',
  'compile-response.schema.json',
  'revise-request.schema.json',
  'revise-response.schema.json',
  'error-response.schema.json',
];

describe('JSON Schema contracts', () => {
  it('compiles every Draft 2020-12 schema and resolves local references', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat(
      'uuid',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    for (const file of schemaFiles) {
      const url = new URL(`../../../schemas/${file}`, import.meta.url);
      const schema = JSON.parse(readFileSync(url, 'utf8')) as AnySchema;
      ajv.addSchema(schema);
    }

    for (const file of schemaFiles) {
      const id = `https://example.local/schemas/${file}`;
      expect(ajv.getSchema(id), `${file} did not compile`).toBeTypeOf(
        'function',
      );
    }
  });
});
