import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../public/manifest.json', import.meta.url);

describe('Chrome manifest', () => {
  it('declares only the M1 permissions and a Side Panel entry', () => {
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
      manifest_version: number;
      permissions: string[];
      side_panel?: { default_path?: string };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['sidePanel', 'storage']);
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
  });
});
