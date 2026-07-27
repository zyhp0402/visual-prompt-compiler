import {
  CompileResponseSchema,
  DirectionSchema,
  TaskTypeSchema,
  type CompileResponse,
} from '@vpc/contracts';

type Direction = CompileResponse['directions'][number];

export const STORAGE_KEY = 'vpcState';
export const STORAGE_VERSION = 2;
export const HISTORY_LIMIT = 20;
export const FAVORITES_LIMIT = 50;

export type HistoryEntry = {
  id: string;
  createdAt: string;
  label: string;
  taskType: CompileResponse['normalizedBrief']['taskType'];
  response: CompileResponse;
};

export type FavoriteEntry = {
  id: string;
  createdAt: string;
  requestId: string;
  direction: Direction;
};

export type LocalState = {
  version: 2;
  settings: {
    allowAssumptions: boolean;
    outputLanguage: string;
  };
  history: HistoryEntry[];
  favorites: FavoriteEntry[];
  ui: {
    showAdvanced: boolean;
  };
};

type StateAdapter = {
  read(): Promise<unknown>;
  write(state: LocalState): Promise<void>;
};

const defaults = (): LocalState => ({
  version: STORAGE_VERSION,
  settings: {
    allowAssumptions: true,
    outputLanguage: 'zh-CN',
  },
  history: [],
  favorites: [],
  ui: {
    showAdvanced: false,
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validFavorite = (value: unknown): value is FavoriteEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.createdAt === 'string' &&
  typeof value.requestId === 'string' &&
  DirectionSchema.safeParse(value.direction).success;

const currentHistory = (value: unknown): HistoryEntry | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.label !== 'string' ||
    !TaskTypeSchema.safeParse(value.taskType).success
  ) {
    return null;
  }
  const response = CompileResponseSchema.safeParse(value.response);
  if (!response.success) return null;
  return {
    id: value.id,
    createdAt: value.createdAt,
    label: value.label,
    taskType: response.data.normalizedBrief.taskType,
    response: response.data,
  };
};

const legacyHistory = (value: unknown): HistoryEntry | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }
  const response = CompileResponseSchema.safeParse(value.response);
  if (!response.success) return null;
  return historyEntryFromResponse(response.data, value.createdAt);
};

const normalize = (
  value: Record<string, unknown>,
  legacy: boolean,
): LocalState | null => {
  const settings = isRecord(value.settings) ? value.settings : {};
  const ui = isRecord(value.ui) ? value.ui : {};
  const historyValues = Array.isArray(value.history) ? value.history : [];
  const favoriteValues = Array.isArray(value.favorites) ? value.favorites : [];
  const history = historyValues.map(legacy ? legacyHistory : currentHistory);
  if (
    history.some((entry) => entry === null) ||
    !favoriteValues.every(validFavorite)
  ) {
    return null;
  }

  return {
    version: STORAGE_VERSION,
    settings: {
      allowAssumptions:
        typeof settings.allowAssumptions === 'boolean'
          ? settings.allowAssumptions
          : true,
      outputLanguage:
        typeof settings.outputLanguage === 'string' &&
        settings.outputLanguage.length >= 2
          ? settings.outputLanguage
          : 'zh-CN',
    },
    history: (history as HistoryEntry[]).slice(0, HISTORY_LIMIT),
    favorites: favoriteValues.slice(0, FAVORITES_LIMIT),
    ui: {
      showAdvanced:
        typeof ui.showAdvanced === 'boolean' ? ui.showAdvanced : false,
    },
  };
};

export const migrateStoredState = (value: unknown): LocalState => {
  if (value === undefined || value === null) return defaults();
  if (!isRecord(value)) return defaults();
  if (
    value.version !== undefined &&
    value.version !== 0 &&
    value.version !== 1 &&
    value.version !== 2
  ) {
    return defaults();
  }
  return normalize(value, value.version !== 2) ?? defaults();
};

export const createStateStore = (adapter: StateAdapter) => {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const operation = queue.then(work);
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return {
    load: (): Promise<LocalState> =>
      enqueue(async () => {
        const stored = await adapter.read();
        const sanitized = migrateStoredState(stored);
        if (JSON.stringify(stored) !== JSON.stringify(sanitized)) {
          await adapter.write(sanitized);
        }
        return sanitized;
      }),
    update: (
      transform: (state: LocalState) => LocalState,
    ): Promise<LocalState> =>
      enqueue(async () => {
        const current = migrateStoredState(await adapter.read());
        const next = transform(current);
        await adapter.write(next);
        return next;
      }),
  };
};

const browserStore = createStateStore({
  read: async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY];
  },
  write: async (state) => {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  },
});

export const loadLocalState = (): Promise<LocalState> => browserStore.load();

export const updateLocalState = (
  transform: (state: LocalState) => LocalState,
): Promise<LocalState> => browserStore.update(transform);

export const historyEntryFromResponse = (
  response: CompileResponse,
  createdAt = new Date().toISOString(),
): HistoryEntry => ({
  id: response.requestId,
  createdAt,
  label: response.normalizedBrief.goal,
  taskType: response.normalizedBrief.taskType,
  response,
});

export const withHistory = (
  state: LocalState,
  entry: HistoryEntry,
): LocalState => ({
  ...state,
  history: [entry, ...state.history.filter(({ id }) => id !== entry.id)].slice(
    0,
    HISTORY_LIMIT,
  ),
});

export const toggleFavorite = (
  state: LocalState,
  entry: FavoriteEntry,
): LocalState => {
  const exists = state.favorites.some(
    ({ requestId, direction }) =>
      requestId === entry.requestId && direction.mode === entry.direction.mode,
  );
  return {
    ...state,
    favorites: exists
      ? state.favorites.filter(
          ({ requestId, direction }) =>
            !(
              requestId === entry.requestId &&
              direction.mode === entry.direction.mode
            ),
        )
      : [entry, ...state.favorites].slice(0, FAVORITES_LIMIT),
  };
};

export const createInitialLocalState = defaults;
