import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

test('loads the unpacked Side Panel in Chromium', async () => {
  const extensionPath = resolve('apps/extension/dist');
  const userDataDir = await mkdtemp(join(tmpdir(), 'vpc-extension-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const extensionsPage = context.pages()[0] ?? (await context.newPage());
    await extensionsPage.goto('chrome://extensions');

    const extensionId = await extensionsPage
      .locator('extensions-manager')
      .evaluate((manager) => {
        const list = manager.shadowRoot?.querySelector('extensions-item-list');
        const items =
          list?.shadowRoot?.querySelectorAll('extensions-item') ?? [];

        for (const item of items) {
          const name = item.shadowRoot
            ?.querySelector('#name')
            ?.textContent?.trim();
          if (name === '视觉提示词编译器') {
            return item.getAttribute('id');
          }
        }

        return null;
      });

    expect(extensionId).not.toBeNull();

    const sidePanel = await context.newPage();
    await sidePanel.goto(
      `chrome-extension://${extensionId ?? ''}/sidepanel.html`,
    );
    await expect(
      sidePanel.getByRole('heading', { name: '视觉提示词编译器' }),
    ).toBeVisible();
    await expect(sidePanel.getByText('M1 脚手架已就绪')).toBeVisible();
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
