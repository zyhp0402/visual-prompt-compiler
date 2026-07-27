import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../public/manifest.json', import.meta.url);

describe('Chrome manifest', () => {
  it('declares only M4 storage, Side Panel, and exact local API access', () => {
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
      manifest_version: number;
      permissions: string[];
      host_permissions?: string[];
      side_panel?: { default_path?: string };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['sidePanel', 'storage']);
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://localhost/*',
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(
      /activeTab|<all_urls>|contextMenus|unlimitedStorage/,
    );
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
  });
});
