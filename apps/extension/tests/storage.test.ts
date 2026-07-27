import { describe, expect, it } from 'vitest';

import {
  FAVORITES_LIMIT,
  HISTORY_LIMIT,
  createInitialLocalState,
  createStateStore,
  historyEntryFromResponse,
  migrateStoredState,
  toggleFavorite,
  withHistory,
  type FavoriteEntry,
  type HistoryEntry,
  type LocalState,
} from '../src/storage.js';
import { validCompileRequest, validCompileResponse } from './fixtures.js';

const historyEntry = (index: number): HistoryEntry =>
  historyEntryFromResponse(
    {
      ...validCompileResponse,
      requestId: `123e4567-e89b-12d3-a456-${String(index).padStart(12, '0')}`,
    },
    new Date(index).toISOString(),
  );

const favoriteEntry = (index: number): FavoriteEntry => ({
  id: `favorite-${index}`,
  createdAt: new Date(index).toISOString(),
  requestId: `request-${index}`,
  direction:
    validCompileResponse.directions[
      index % validCompileResponse.directions.length
    ]!,
});

describe('versioned extension storage', () => {
  it('migrates empty data into v2 defaults', () => {
    expect(migrateStoredState(undefined)).toEqual(createInitialLocalState());
    expect(createInitialLocalState().version).toBe(2);
  });

  it('migrates v1 history without retaining the original request or brief', () => {
    const sensitive = 'PRIVATE-BRIEF-UNIQUE-6f4d7c';
    const migrated = migrateStoredState({
      version: 1,
      settings: { allowAssumptions: false, outputLanguage: 'en' },
      history: [
        {
          id: 'legacy',
          createdAt: '2026-07-27T00:00:00.000Z',
          request: { ...validCompileRequest, brief: sensitive },
          response: validCompileResponse,
        },
      ],
      favorites: [],
      ui: { showAdvanced: true },
    });

    expect(migrated).toMatchObject({
      version: 2,
      settings: { allowAssumptions: false, outputLanguage: 'en' },
      ui: { showAdvanced: true },
    });
    expect(migrated.history[0]).toMatchObject({
      label: validCompileResponse.normalizedBrief.goal,
      taskType: validCompileResponse.normalizedBrief.taskType,
    });
    expect(JSON.stringify(migrated)).not.toContain(sensitive);
    expect(migrated.history[0]).not.toHaveProperty('request');
  });

  it('falls back safely for corrupt or unknown-version data', () => {
    expect(migrateStoredState('broken')).toEqual(createInitialLocalState());
    expect(
      migrateStoredState({ version: 2, history: [{}], favorites: [] }),
    ).toEqual(createInitialLocalState());
    expect(migrateStoredState({ version: 99 })).toEqual(
      createInitialLocalState(),
    );
  });

  it('caps history at 20 and favorites at 50', () => {
    let state = createInitialLocalState();
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      state = withHistory(state, historyEntry(index));
    }
    expect(state.history).toHaveLength(HISTORY_LIMIT);
    expect(state.history[0]?.id).toBe(`123e4567-e89b-12d3-a456-000000000024`);

    for (let index = 0; index < FAVORITES_LIMIT + 5; index += 1) {
      state = toggleFavorite(state, favoriteEntry(index));
    }
    expect(state.favorites).toHaveLength(FAVORITES_LIMIT);
  });

  it('toggles the same request direction without duplicates', () => {
    const entry = favoriteEntry(1);
    const added = toggleFavorite(createInitialLocalState(), entry);
    expect(added.favorites).toHaveLength(1);
    expect(toggleFavorite(added, entry).favorites).toHaveLength(0);
  });

  it('serializes delayed functional updates without losing two favorites', async () => {
    let persisted: LocalState = createInitialLocalState();
    const store = createStateStore({
      read: async () => persisted,
      write: async (next) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        persisted = structuredClone(next);
      },
    });

    await Promise.all([
      store.update((state) => toggleFavorite(state, favoriteEntry(1))),
      store.update((state) => toggleFavorite(state, favoriteEntry(2))),
    ]);

    expect(persisted.favorites).toHaveLength(2);
  });

  it('does not let a later history write overwrite settings or favorites', async () => {
    let persisted: LocalState = createInitialLocalState();
    const store = createStateStore({
      read: async () => structuredClone(persisted),
      write: async (next) => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        persisted = structuredClone(next);
      },
    });

    await Promise.all([
      store.update((state) => ({
        ...state,
        settings: { ...state.settings, allowAssumptions: false },
      })),
      store.update((state) => toggleFavorite(state, favoriteEntry(3))),
      store.update((state) => withHistory(state, historyEntry(4))),
    ]);

    expect(persisted.settings.allowAssumptions).toBe(false);
    expect(persisted.favorites).toHaveLength(1);
    expect(persisted.history).toHaveLength(1);
  });

  it('physically rewrites legacy storage and removes the sensitive request', async () => {
    const sensitive = 'PHYSICAL-LEGACY-SECRET-c1849a';
    let persisted: unknown = {
      version: 1,
      settings: { allowAssumptions: true, outputLanguage: 'zh-CN' },
      history: [
        {
          id: 'legacy',
          createdAt: '2026-07-27T00:00:00.000Z',
          request: { ...validCompileRequest, brief: sensitive },
          response: validCompileResponse,
        },
      ],
      favorites: [],
      ui: { showAdvanced: false },
    };
    const store = createStateStore({
      read: async () => structuredClone(persisted),
      write: async (next) => {
        persisted = structuredClone(next);
      },
    });

    await store.load();

    expect(JSON.stringify(persisted)).not.toContain(sensitive);
    expect(JSON.stringify(persisted)).not.toContain('"request"');
    expect(persisted).toMatchObject({ version: 2 });
  });

  it('queues delayed hydration with updates so stale S0 cannot resolve last', async () => {
    let persisted: unknown = {
      version: 1,
      settings: { allowAssumptions: true, outputLanguage: 'zh-CN' },
      history: [],
      favorites: [],
      ui: { showAdvanced: false },
    };
    let reads = 0;
    const resolutionOrder: string[] = [];
    const store = createStateStore({
      read: async () => {
        const snapshot = structuredClone(persisted);
        reads += 1;
        if (reads === 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        return snapshot;
      },
      write: async (next) => {
        persisted = structuredClone(next);
      },
    });

    const hydration = store.load().then((state) => {
      resolutionOrder.push('load');
      return state;
    });
    const update = store
      .update((state) => ({
        ...state,
        settings: { ...state.settings, allowAssumptions: false },
      }))
      .then((state) => {
        resolutionOrder.push('update');
        return state;
      });

    await Promise.all([hydration, update]);

    expect(resolutionOrder).toEqual(['load', 'update']);
    expect(persisted).toMatchObject({
      version: 2,
      settings: { allowAssumptions: false },
    });
  });
});
