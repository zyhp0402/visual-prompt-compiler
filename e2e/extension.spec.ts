import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  validCompileResponse,
  validCompileRequest,
} from '../apps/extension/tests/fixtures.js';

type FixtureDirection = (typeof validCompileResponse.directions)[number];

const requests: Array<{ path: string; body: Record<string, unknown> }> = [];

const readBody = async (
  request: IncomingMessage,
): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  response.end(JSON.stringify(body));
};

const errorBody = (
  code: 'MODEL_TIMEOUT' | 'RATE_LIMITED' | 'UPSTREAM_ERROR',
) => ({
  requestId: '123e4567-e89b-12d3-a456-426614174999',
  error: {
    code,
    message: code,
    retryable: true,
    details: [],
  },
});

const compileResponseFor = (goal: string, requestId: string) => ({
  ...validCompileResponse,
  requestId,
  normalizedBrief: {
    ...validCompileResponse.normalizedBrief,
    goal,
  },
});

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    response.end();
    return;
  }

  if (request.method !== 'POST' || !request.url) {
    sendJson(response, 404, {});
    return;
  }

  const body = await readBody(request);
  requests.push({ path: request.url, body });
  const brief = String(body.brief ?? '');
  if (brief.includes('错误-离线')) {
    request.socket.destroy();
    return;
  }
  if (brief.includes('错误-超时')) {
    sendJson(response, 504, errorBody('MODEL_TIMEOUT'));
    return;
  }
  if (brief.includes('错误-限流')) {
    sendJson(response, 429, errorBody('RATE_LIMITED'));
    return;
  }
  if (brief.includes('错误-无效输出')) {
    sendJson(response, 200, { directions: [] });
    return;
  }
  if (brief.includes('慢-A')) {
    await new Promise((resolve) =>
      setTimeout(resolve, brief.includes('清空历史') ? 1_200 : 250),
    );
    sendJson(
      response,
      200,
      compileResponseFor(
        '慢 A 不应回灌',
        '123e4567-e89b-12d3-a456-426614174010',
      ),
    );
    return;
  }
  if (brief.includes('快速-B')) {
    sendJson(
      response,
      200,
      compileResponseFor(
        '快速 B 最新结果',
        '123e4567-e89b-12d3-a456-426614174011',
      ),
    );
    return;
  }

  if (request.url === '/v1/revise') {
    sendJson(response, 200, {
      result: {
        ...validCompileResponse,
        requestId: '123e4567-e89b-12d3-a456-426614174001',
        directions: validCompileResponse.directions.map(
          (direction: FixtureDirection) =>
            direction.mode === body.targetMode
              ? { ...direction, name: `${direction.name}（已修改）` }
              : direction,
        ),
      },
      changes: [
        { path: 'lighting', before: '城市反光', after: '雨后清晨光线' },
      ],
    });
    return;
  }

  sendJson(response, 200, validCompileResponse);
});

test.beforeAll(
  async () =>
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(8787, '127.0.0.1', resolve);
    }),
);

test.afterAll(
  async () =>
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

const extensionIdFrom = async (context: BrowserContext): Promise<string> => {
  const extensionsPage = context.pages()[0] ?? (await context.newPage());
  await extensionsPage.goto('chrome://extensions');
  const extensionId = await extensionsPage
    .locator('extensions-manager')
    .evaluate((manager) => {
      const list = manager.shadowRoot?.querySelector('extensions-item-list');
      const items = list?.shadowRoot?.querySelectorAll('extensions-item') ?? [];
      for (const item of items) {
        const name = item.shadowRoot
          ?.querySelector('#name')
          ?.textContent?.trim();
        if (name === '视觉提示词编译器') return item.getAttribute('id');
      }
      return null;
    });
  expect(extensionId).not.toBeNull();
  return extensionId ?? '';
};

const openSidePanel = async (
  context: BrowserContext,
  extensionId: string,
): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(
    page.getByRole('heading', { name: '视觉提示词编译器' }),
  ).toBeVisible();
  return page;
};

const extensionStorage = {
  get: async (page: Page): Promise<Record<string, unknown>> =>
    page.evaluate(async () => {
      const extensionGlobal = globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              get(key: string): Promise<Record<string, unknown>>;
            };
          };
        };
      };
      return extensionGlobal.chrome.storage.local.get('vpcState');
    }),
  set: async (page: Page, value: unknown): Promise<void> =>
    page.evaluate(async (state) => {
      const extensionGlobal = globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              set(value: Record<string, unknown>): Promise<void>;
            };
          };
        };
      };
      await extensionGlobal.chrome.storage.local.set({ vpcState: state });
    }, value),
};

test('runs compile, copy, favorite, persistent history, and targeted revise', async () => {
  requests.length = 0;
  const extensionPath = resolve('apps/extension/dist');
  const userDataDir = await mkdtemp(join(tmpdir(), 'vpc-extension-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (globalThis as typeof globalThis & { __copied?: string }).__copied =
            text;
        },
      },
    });
  });

  try {
    const extensionId = await extensionIdFrom(context);
    const sidePanel = await openSidePanel(context, extensionId);
    const legacySecret = 'PRESET-V1-SECRET-284fe1';
    await extensionStorage.set(sidePanel, {
      version: 1,
      settings: { allowAssumptions: true, outputLanguage: 'zh-CN' },
      history: [
        {
          id: 'legacy',
          createdAt: '2026-07-27T00:00:00.000Z',
          request: { ...validCompileRequest, brief: legacySecret },
          response: validCompileResponse,
        },
      ],
      favorites: [],
      ui: { showAdvanced: false },
    });
    await sidePanel.reload();
    await expect(
      sidePanel.getByRole('button', { name: /历史 1/ }),
    ).toBeVisible();
    const hydratedStorage = JSON.stringify(
      await extensionStorage.get(sidePanel),
    );
    expect(hydratedStorage).not.toContain(legacySecret);
    expect(hydratedStorage).not.toContain('"request"');
    expect(JSON.parse(hydratedStorage).vpcState).toMatchObject({ version: 2 });
    await sidePanel.getByRole('button', { name: /历史 1/ }).click();
    await sidePanel.getByRole('button', { name: '清空历史' }).click();
    await expect(sidePanel.getByText('还没有编译记录。')).toBeVisible();
    await sidePanel.getByRole('button', { name: /历史 0/ }).click();

    const sensitiveBrief = 'PRIVATE-E2E-BRIEF-95a31d';
    await sidePanel.getByLabel('描述你想要的画面').fill(sensitiveBrief);
    await sidePanel.getByLabel('手动指定').check();
    await sidePanel.getByLabel('选择任务类型').selectOption('poster');
    await sidePanel.getByLabel('画面比例').selectOption('3:4');
    await sidePanel
      .getByLabel('必须出现的文字')
      .fill(validCompileRequest.mandatoryText.join('\n'));
    await sidePanel
      .getByLabel('必须元素')
      .fill(validCompileRequest.mandatoryElements.join('\n'));
    await sidePanel
      .getByLabel('禁止元素')
      .fill(validCompileRequest.forbiddenElements.join('\n'));
    await sidePanel.getByRole('button', { name: '编译三份方向' }).click();

    await expect(sidePanel.locator('.direction-card')).toHaveCount(3);
    await expect(sidePanel.locator('#result')).toBeFocused();
    expect(requests[0]).toMatchObject({
      path: '/v1/compile',
      body: {
        taskType: 'poster',
        aspectRatio: '3:4',
        mandatoryText: ['夜行城市'],
        mandatoryElements: ['潮湿街道'],
        forbiddenElements: ['汽车'],
      },
    });
    const serializedStorage = JSON.stringify(
      await extensionStorage.get(sidePanel),
    );
    expect(serializedStorage).not.toContain(sensitiveBrief);
    expect(JSON.parse(serializedStorage).vpcState).toMatchObject({
      version: 2,
      history: [
        {
          label: validCompileResponse.normalizedBrief.goal,
          taskType: validCompileResponse.normalizedBrief.taskType,
        },
      ],
    });
    expect(serializedStorage).not.toContain('"request"');

    const creative = sidePanel.locator('.direction-creative');
    await creative.getByRole('button', { name: '复制完整提示词' }).click();
    await expect(
      creative.getByRole('button', { name: '已复制' }),
    ).toBeVisible();
    expect(
      await sidePanel.evaluate(
        () =>
          (globalThis as typeof globalThis & { __copied?: string }).__copied,
      ),
    ).toContain('creative 完整提示词');

    await creative.getByRole('button', { name: '收藏方向' }).click();
    await expect(
      creative.getByRole('button', { name: '取消收藏' }),
    ).toBeVisible();

    await creative.getByLabel('只修改这个方向').fill('改为雨后清晨光线');
    await creative.getByRole('button', { name: '提交修改' }).click();
    await expect(
      sidePanel.getByRole('heading', { name: 'creative-方向（已修改）' }),
    ).toBeVisible();
    expect(requests.at(-1)).toMatchObject({
      path: '/v1/revise',
      body: {
        targetMode: 'creative',
        preserveOtherDirections: true,
        instruction: '改为雨后清晨光线',
      },
    });
    expect(requests.at(-1)?.body.previousSpec).toBeTruthy();
    expect(requests.at(-1)?.body.previousDirections).toHaveLength(3);

    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: /历史 2/ }).click();
    await expect(
      sidePanel.getByText(validCompileResponse.normalizedBrief.goal).first(),
    ).toBeVisible();
    await sidePanel
      .getByRole('button', { name: '恢复这次结果' })
      .first()
      .click();
    await expect(sidePanel.locator('#result')).toBeFocused();
    await sidePanel.getByRole('button', { name: /历史 2/ }).click();
    await sidePanel.getByRole('button', { name: '清空历史' }).click();
    await expect(
      sidePanel.getByRole('heading', { name: '最近历史' }),
    ).toBeFocused();
    await expect(sidePanel.getByText('还没有编译记录。')).toBeVisible();
    await sidePanel.getByRole('button', { name: /收藏 1/ }).click();
    await expect(sidePanel.getByText('创意 · creative-方向')).toBeVisible();
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('shows controlled timeout, offline, rate-limit, and invalid-output states', async () => {
  const extensionPath = resolve('apps/extension/dist');
  const userDataDir = await mkdtemp(join(tmpdir(), 'vpc-extension-errors-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const extensionId = await extensionIdFrom(context);
    const sidePanel = await openSidePanel(context, extensionId);
    await sidePanel.getByLabel('描述你想要的画面').fill('慢-A');
    await sidePanel.getByRole('button', { name: '编译三份方向' }).click();
    await sidePanel.getByRole('button', { name: '新建' }).click();
    await sidePanel.getByLabel('描述你想要的画面').fill('快速-B');
    await sidePanel.getByRole('button', { name: '编译三份方向' }).click();
    await expect(sidePanel.getByText('快速 B 最新结果')).toBeVisible();
    await sidePanel.waitForTimeout(350);
    await expect(sidePanel.getByText('快速 B 最新结果')).toBeVisible();
    await expect(sidePanel.getByText('慢 A 不应回灌')).toHaveCount(0);

    await sidePanel.getByLabel('描述你想要的画面').fill('慢-A 清空历史');
    await sidePanel.getByRole('button', { name: '编译三份方向' }).click();
    await sidePanel.getByRole('button', { name: /历史 1/ }).click();
    await sidePanel.getByRole('button', { name: '清空历史' }).click();
    await expect(
      sidePanel.getByRole('heading', { name: '最近历史' }),
    ).toBeFocused();
    await expect(sidePanel.getByText('慢 A 不应回灌')).toBeVisible();
    await expect(sidePanel.locator('#result')).toBeFocused();
    await expect(sidePanel.locator('.direction-card')).toHaveCount(3);
    await expect(sidePanel.getByText('还没有编译记录。')).toBeVisible();
    await expect(
      sidePanel.getByRole('button', { name: /历史 0/ }),
    ).toBeVisible();
    await sidePanel.getByRole('button', { name: /历史 0/ }).click();

    const cases = [
      ['错误-超时', '服务响应超时，可以稍后重试。'],
      ['错误-离线', '无法连接本地 API。请确认服务已启动且地址可访问。'],
      ['错误-限流', '请求过于频繁，请稍候再试。'],
      ['错误-无效输出', '服务返回的数据未通过契约校验，结果没有被采用。'],
    ] as const;

    for (const [brief, message] of cases) {
      await sidePanel.getByLabel('描述你想要的画面').fill(brief);
      await sidePanel.getByRole('button', { name: '编译三份方向' }).click();
      await expect(sidePanel.locator('.direction-card')).toHaveCount(0);
      await expect(
        sidePanel.getByRole('alert').getByText(message),
      ).toBeVisible();
    }
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
