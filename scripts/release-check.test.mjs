import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateReleaseTree } from './release-check.mjs';

const manifest = {
  manifest_version: 3,
  version: '0.1.0',
  permissions: ['sidePanel', 'storage'],
  host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
};

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vpc-release-check-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'sidepanel.html'), '<main>ok</main>');
  await writeFile(join(directory, 'assets', 'index.js'), 'console.info("ok")');
  return directory;
};

test('accepts the minimal release tree', async () => {
  const directory = await fixture();
  try {
    assert.deepEqual(await validateReleaseTree(directory), {
      version: '0.1.0',
      files: 3,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('rejects source maps, extra permissions, and bundled secrets', async () => {
  for (const mutate of [
    (directory) => writeFile(join(directory, 'assets', 'index.js.map'), '{}'),
    (directory) =>
      writeFile(
        join(directory, 'manifest.json'),
        JSON.stringify({
          ...manifest,
          permissions: [...manifest.permissions, 'tabs'],
        }),
      ),
    (directory) =>
      writeFile(
        join(directory, 'manifest.json'),
        JSON.stringify({
          ...manifest,
          content_scripts: [{ matches: ['https://*/*'], js: ['content.js'] }],
        }),
      ),
    (directory) => writeFile(join(directory, '.env.production'), 'SECRET=x'),
    (directory) =>
      writeFile(join(directory, 'assets', 'index.js'), 'OPENAI_API_KEY'),
  ]) {
    const directory = await fixture();
    try {
      await mutate(directory);
      await assert.rejects(validateReleaseTree(directory));
    } finally {
      await rm(directory, { recursive: true });
    }
  }
});

test('accepts normal Chrome versions and rejects invalid or all-zero versions', async () => {
  for (const version of ['0.0.1', '1.0.0', '65535.0.0.0']) {
    const directory = await fixture();
    try {
      await writeFile(
        join(directory, 'manifest.json'),
        JSON.stringify({ ...manifest, version }),
      );
      assert.equal((await validateReleaseTree(directory)).version, version);
    } finally {
      await rm(directory, { recursive: true });
    }
  }
  for (const version of ['0.0.0', '01.0.0', '65536.0.0']) {
    const directory = await fixture();
    try {
      await writeFile(
        join(directory, 'manifest.json'),
        JSON.stringify({ ...manifest, version }),
      );
      await assert.rejects(validateReleaseTree(directory));
    } finally {
      await rm(directory, { recursive: true });
    }
  }
});
