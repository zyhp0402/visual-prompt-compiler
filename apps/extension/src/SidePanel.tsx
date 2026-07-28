import {
  CompileRequestSchema,
  type CompileRequest,
  type CompileResponse,
} from '@vpc/contracts';
import {
  IMAGE_CONTRACT_VERSION,
  buildImageFeedbackRevision,
  type GenerateResponse,
} from '@vpc/contracts/image';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  ApiClientError,
  DEFAULT_API_BASE_URL,
  compileRequest,
  generateRequest,
  reviseRequest,
} from './api-client.js';
import {
  createInitialLocalState,
  historyEntryFromResponse,
  loadLocalState,
  toggleFavorite,
  updateLocalState,
  withHistory,
  type FavoriteEntry,
  type HistoryEntry,
  type LocalState,
} from './storage.js';
import { aspectRatioOptions, strings, taskTypeOptions } from './strings.js';

type Direction = CompileResponse['directions'][number];
type DirectionMode = Direction['mode'];
type TaskType = Exclude<CompileRequest['taskType'], 'auto'>;
type SupportPanel = 'history' | 'favorites' | 'settings' | null;
type LastAction =
  | { type: 'compile'; input: CompileRequest }
  | {
      type: 'revise';
      input: Parameters<typeof reviseRequest>[0];
    };
type PreviewState = Partial<Record<DirectionMode, GenerateResponse>>;
type PreviewErrors = Partial<Record<DirectionMode, ApiClientError>>;

const emptyRevision: Record<DirectionMode, string> = {
  faithful: '',
  creative: '',
  experimental: '',
};

const splitLines = (value: string): string[] => [
  ...new Set(
    value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

const errorFrom = (error: unknown): ApiClientError =>
  error instanceof ApiClientError
    ? error
    : new ApiClientError('upstream', true);

export const previewSizeForAspectRatio = (
  ratio: string | null | undefined,
): '1024x1024' | '1536x1024' | '1024x1536' => {
  const [width, height] = ratio?.split(':').map(Number) ?? [];
  if (
    width !== undefined &&
    height !== undefined &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    if (width > height) return '1536x1024';
    if (height > width) return '1024x1536';
  }
  return '1024x1024';
};

export function SidePanel() {
  const [taskMode, setTaskMode] = useState<'auto' | 'manual'>('auto');
  const [manualTaskType, setManualTaskType] = useState<TaskType>('poster');
  const [aspectRatio, setAspectRatio] = useState('auto');
  const [customRatio, setCustomRatio] = useState('2:1');
  const [creativity, setCreativity] = useState(50);
  const [result, setResult] = useState<CompileResponse | null>(null);
  const [localState, setLocalState] = useState<LocalState>(
    createInitialLocalState,
  );
  const [supportPanel, setSupportPanel] = useState<SupportPanel>(null);
  const [busy, setBusy] = useState<'compile' | DirectionMode | null>(null);
  const [clientError, setClientError] = useState<ApiClientError | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [revision, setRevision] = useState(emptyRevision);
  const [copiedKey, setCopiedKey] = useState('');
  const [resultFocusToken, setResultFocusToken] = useState(0);
  const [previews, setPreviews] = useState<PreviewState>({});
  const [previewErrors, setPreviewErrors] = useState<PreviewErrors>({});
  const [previewBusy, setPreviewBusy] = useState<DirectionMode | null>(null);
  const [previewLocked, setPreviewLocked] = useState(false);
  const operationId = useRef(0);
  const historyGeneration = useRef(0);
  const previewEpoch = useRef(0);
  const previewOwner = useRef(0);
  const previewLock = useRef(false);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void loadLocalState()
      .then(setLocalState)
      .catch(() => setStorageError(true));
  }, []);

  useEffect(() => {
    if (result && resultFocusToken > 0) resultRef.current?.focus();
  }, [result, resultFocusToken]);

  const persist = async (
    transform: (state: LocalState) => LocalState,
    message?: string,
  ) => {
    try {
      const next = await updateLocalState(transform);
      setLocalState(next);
      setStorageError(false);
      if (message) setLiveMessage(message);
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  };

  const focusResult = (id: number) => {
    if (operationId.current === id) {
      setResultFocusToken((value) => value + 1);
    }
  };

  const invalidatePreviews = () => {
    previewEpoch.current += 1;
    setPreviewBusy(null);
    setPreviews({});
    setPreviewErrors({});
  };

  const invalidateOperations = () => {
    operationId.current += 1;
    setBusy(null);
    invalidatePreviews();
  };

  const runCompile = async (input: CompileRequest) => {
    const id = ++operationId.current;
    const historyVersion = historyGeneration.current;
    setBusy('compile');
    setResult(null);
    invalidatePreviews();
    setClientError(null);
    setLastAction({ type: 'compile', input });
    setLiveMessage(strings.status.loading);
    try {
      const response = await compileRequest(input);
      if (operationId.current !== id) return;
      setResult(response);
      setLiveMessage(strings.status.compileSuccess);
      focusResult(id);
      const entry = historyEntryFromResponse(response);
      await persist((state) =>
        operationId.current === id &&
        historyGeneration.current === historyVersion
          ? withHistory(state, entry)
          : state,
      );
    } catch (error) {
      if (operationId.current !== id) return;
      setClientError(errorFrom(error));
      setLiveMessage('');
    } finally {
      if (operationId.current === id) setBusy(null);
    }
  };

  const onCompile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const candidate = CompileRequestSchema.safeParse({
      brief: data.get('brief'),
      taskType: taskMode === 'auto' ? 'auto' : manualTaskType,
      aspectRatio: aspectRatio === 'custom' ? customRatio : aspectRatio,
      mandatoryText: splitLines(String(data.get('mandatoryText') ?? '')),
      mandatoryElements: splitLines(
        String(data.get('mandatoryElements') ?? ''),
      ),
      forbiddenElements: splitLines(
        String(data.get('forbiddenElements') ?? ''),
      ),
      creativity,
      allowAssumptions: localState.settings.allowAssumptions,
      outputLanguage: localState.settings.outputLanguage,
    });
    if (!candidate.success) {
      setClientError(new ApiClientError('invalid_request', false));
      return;
    }
    void runCompile(candidate.data);
  };

  const runRevise = async (input: Parameters<typeof reviseRequest>[0]) => {
    const mode = input.targetMode;
    if (!mode) return;
    const id = ++operationId.current;
    const historyVersion = historyGeneration.current;
    setBusy(mode);
    invalidatePreviews();
    setClientError(null);
    setLastAction({ type: 'revise', input });
    setLiveMessage(strings.status.loading);
    try {
      const response = await reviseRequest(input);
      if (operationId.current !== id) return;
      setResult(response.result);
      setRevision((value) => ({ ...value, [mode]: '' }));
      setLiveMessage(strings.status.reviseSuccess);
      focusResult(id);
      const entry = historyEntryFromResponse(response.result);
      await persist((state) =>
        operationId.current === id &&
        historyGeneration.current === historyVersion
          ? withHistory(state, entry)
          : state,
      );
    } catch (error) {
      if (operationId.current !== id) return;
      setClientError(errorFrom(error));
      setLiveMessage('');
    } finally {
      if (operationId.current === id) setBusy(null);
    }
  };

  const onRevise = (mode: DirectionMode) => {
    if (!result || !revision[mode].trim()) return;
    void runRevise({
      previousSpec: result.normalizedBrief,
      previousDirections: result.directions,
      instruction: revision[mode].trim(),
      targetMode: mode,
      preserveOtherDirections: true,
    });
  };

  const previewSize = (): '1024x1024' | '1536x1024' | '1024x1536' => {
    return previewSizeForAspectRatio(result?.normalizedBrief.aspectRatio.value);
  };

  const generatePreview = async (direction: Direction) => {
    if (previewLock.current) return;
    previewLock.current = true;
    const epoch = ++previewEpoch.current;
    const owner = ++previewOwner.current;
    const operation = operationId.current;
    setPreviewBusy(direction.mode);
    setPreviewLocked(true);
    setPreviewErrors((current) => {
      const next = { ...current };
      delete next[direction.mode];
      return next;
    });
    try {
      const response = await generateRequest({
        imageContractVersion: IMAGE_CONTRACT_VERSION,
        source: { kind: 'text', prompt: direction.fullPrompt },
        n: 1,
        size: previewSize(),
        quality: 'low',
        outputFormat: 'png',
      });
      if (previewEpoch.current !== epoch || operationId.current !== operation) {
        return;
      }
      setPreviews((current) => ({ ...current, [direction.mode]: response }));
      setLiveMessage(strings.status.previewSuccess);
    } catch (error) {
      if (previewEpoch.current !== epoch || operationId.current !== operation) {
        return;
      }
      setPreviewErrors((current) => ({
        ...current,
        [direction.mode]: errorFrom(error),
      }));
    } finally {
      if (previewOwner.current === owner) {
        previewLock.current = false;
        setPreviewLocked(false);
        setPreviewBusy(null);
      }
    }
  };

  const applyImageFeedback = (
    mode: DirectionMode,
    issue: string,
    note: string,
  ) => {
    const patch = buildImageFeedbackRevision({
      targetMode: mode,
      issues: [issue],
      note,
    });
    setRevision((current) => ({
      ...current,
      [mode]: patch.instruction,
    }));
    setLiveMessage(strings.status.feedbackReady);
  };

  const retry = () => {
    if (!lastAction) return;
    if (lastAction.type === 'compile') {
      void runCompile(lastAction.input);
    } else {
      void runRevise(lastAction.input);
    }
  };

  const copyPrompt = async (key: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedKey(key);
      setLiveMessage(strings.result.copied);
      globalThis.setTimeout(
        () => setCopiedKey((current) => (current === key ? '' : current)),
        1800,
      );
    } catch {
      setLiveMessage(strings.status.copyError);
    }
  };

  const isFavorite = (direction: Direction) =>
    !!result &&
    localState.favorites.some(
      (entry) =>
        entry.requestId === result.requestId &&
        entry.direction.mode === direction.mode,
    );

  const onFavorite = (direction: Direction) => {
    if (!result) return;
    const entry: FavoriteEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      requestId: result.requestId,
      direction,
    };
    void persist((state) => toggleFavorite(state, entry), strings.status.saved);
  };

  const restoreHistory = (entry: HistoryEntry) => {
    invalidateOperations();
    setResult(entry.response);
    setSupportPanel(null);
    setClientError(null);
    setLiveMessage(strings.status.restoreSuccess);
    const id = operationId.current;
    focusResult(id);
  };

  const updateSettings = (patch: Partial<LocalState['settings']>) => {
    void persist((state) => ({
      ...state,
      settings: { ...state.settings, ...patch },
    }));
  };

  const updateAdvanced = (showAdvanced: boolean) => {
    void persist((state) => ({ ...state, ui: { showAdvanced } }));
  };

  const clearHistory = () => {
    historyGeneration.current += 1;
    void persist(
      (state) => ({ ...state, history: [] }),
      strings.status.cleared,
    );
  };

  const clearFavorites = () => {
    void persist(
      (state) => ({ ...state, favorites: [] }),
      strings.status.cleared,
    );
  };

  const resetDraft = () => {
    invalidateOperations();
    setResult(null);
    setClientError(null);
    setRevision(emptyRevision);
    setSupportPanel(null);
    setLiveMessage('');
    document.querySelector<HTMLFormElement>('#compile-form')?.reset();
    setTaskMode('auto');
    setManualTaskType('poster');
    setAspectRatio('auto');
    setCustomRatio('2:1');
    setCreativity(50);
  };

  const risks = useMemo(() => {
    if (!result) return [];
    return [
      ...new Set([
        ...result.riskFlags,
        ...result.normalizedBrief.riskFlags,
        ...result.normalizedBrief.unresolvedQuestions.map(
          ({ question }) => question,
        ),
      ]),
    ];
  }, [result]);

  return (
    <main className="workbench">
      <header className="masthead">
        <div>
          <p className="edition">{strings.edition}</p>
          <h1>{strings.title}</h1>
          <p className="description">{strings.description}</p>
        </div>
        <span className="proof-mark" aria-hidden="true">
          校
        </span>
      </header>

      <nav className="tool-nav" aria-label="工作区">
        <button type="button" onClick={resetDraft}>
          {strings.nav.newDraft}
        </button>
        {(['history', 'favorites', 'settings'] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            aria-pressed={supportPanel === panel}
            onClick={() =>
              setSupportPanel((current) => (current === panel ? null : panel))
            }
          >
            {strings.nav[panel]}
            {panel === 'history'
              ? ` ${localState.history.length}`
              : panel === 'favorites'
                ? ` ${localState.favorites.length}`
                : ''}
          </button>
        ))}
      </nav>

      {supportPanel === 'history' && (
        <SupportList
          title={strings.panels.historyTitle}
          empty={strings.panels.emptyHistory}
          entries={localState.history}
          label={(entry) => entry.label}
          meta={(entry) =>
            `${entry.taskType} · ${new Date(entry.createdAt).toLocaleString('zh-CN')}`
          }
          action={strings.panels.restore}
          onAction={restoreHistory}
          clearLabel={strings.panels.removeHistory}
          onClear={clearHistory}
        />
      )}

      {supportPanel === 'favorites' && (
        <SupportList
          title={strings.panels.favoritesTitle}
          empty={strings.panels.emptyFavorites}
          entries={localState.favorites}
          label={(entry) =>
            `${strings.result.modes[entry.direction.mode]} · ${entry.direction.name}`
          }
          meta={(entry) => entry.direction.concept}
          action={strings.result.copyFull}
          onAction={(entry) =>
            void copyPrompt(`favorite-${entry.id}`, entry.direction.fullPrompt)
          }
          clearLabel={strings.panels.clearFavorites}
          onClear={clearFavorites}
        />
      )}

      {supportPanel === 'settings' && (
        <section className="support-panel" aria-labelledby="settings-title">
          <h2 id="settings-title">{strings.panels.settingsTitle}</h2>
          <dl className="settings-list">
            <div>
              <dt>{strings.panels.apiEndpoint}</dt>
              <dd>
                <code>{DEFAULT_API_BASE_URL}</code>
                <small>{strings.panels.apiEndpointHint}</small>
              </dd>
            </div>
            <div>
              <dt>{strings.panels.storageCounts}</dt>
              <dd>{strings.panels.storageCountsValue}</dd>
            </div>
          </dl>
          <p className="local-note">{strings.panels.localOnly}</p>
        </section>
      )}

      {storageError && (
        <p className="notice notice-error" role="alert">
          {strings.status.storageError}
        </p>
      )}
      <p className="sr-live" aria-live="polite">
        {liveMessage}
      </p>

      <form id="compile-form" className="brief-sheet" onSubmit={onCompile}>
        <SectionHeading number="01" title={strings.form.section.slice(5)} />
        <label htmlFor="brief">{strings.form.brief}</label>
        <textarea
          id="brief"
          name="brief"
          required
          maxLength={10_000}
          rows={6}
          placeholder={strings.form.briefPlaceholder}
        />

        <fieldset className="type-switch">
          <legend>{strings.form.typeLegend}</legend>
          <label>
            <input
              type="radio"
              name="taskMode"
              checked={taskMode === 'auto'}
              onChange={() => setTaskMode('auto')}
            />
            {strings.form.autoType}
          </label>
          <label>
            <input
              type="radio"
              name="taskMode"
              checked={taskMode === 'manual'}
              onChange={() => setTaskMode('manual')}
            />
            {strings.form.manualType}
          </label>
        </fieldset>

        {taskMode === 'manual' && (
          <label>
            {strings.form.manualTypeLabel}
            <select
              value={manualTaskType}
              onChange={(event) =>
                setManualTaskType(event.target.value as TaskType)
              }
            >
              {taskTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="two-column">
          <label>
            {strings.form.aspectRatio}
            <select
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
            >
              {aspectRatioOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {aspectRatio === 'custom' && (
            <label>
              {strings.form.customRatio}
              <input
                value={customRatio}
                pattern="[1-9][0-9]*(\.[0-9]+)?:[1-9][0-9]*(\.[0-9]+)?"
                onChange={(event) => setCustomRatio(event.target.value)}
              />
            </label>
          )}
        </div>

        <ListField
          id="mandatoryText"
          label={strings.form.mandatoryText}
          hint={strings.form.mandatoryTextHint}
        />
        <div className="two-column">
          <ListField
            id="mandatoryElements"
            label={strings.form.mandatoryElements}
            hint={strings.form.listHint}
          />
          <ListField
            id="forbiddenElements"
            label={strings.form.forbiddenElements}
            hint={strings.form.listHint}
          />
        </div>

        <label className="range-field">
          <span>
            {strings.form.creativity}
            <output>{creativity}</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={creativity}
            onChange={(event) => setCreativity(Number(event.target.value))}
          />
        </label>

        <details
          open={localState.ui.showAdvanced}
          onToggle={(event) =>
            updateAdvanced((event.currentTarget as HTMLDetailsElement).open)
          }
        >
          <summary>{strings.form.advanced}</summary>
          <div className="advanced-grid">
            <label className="check-field">
              <input
                type="checkbox"
                checked={localState.settings.allowAssumptions}
                onChange={(event) =>
                  updateSettings({
                    allowAssumptions: event.target.checked,
                  })
                }
              />
              {strings.form.allowAssumptions}
            </label>
            <label>
              {strings.form.outputLanguage}
              <select
                value={localState.settings.outputLanguage}
                onChange={(event) =>
                  updateSettings({
                    outputLanguage: event.target.value,
                  })
                }
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </details>

        <div className="form-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={busy !== null}
          >
            {busy === 'compile' ? strings.form.compiling : strings.form.compile}
          </button>
          <button className="text-button" type="button" onClick={resetDraft}>
            {strings.form.reset}
          </button>
        </div>
      </form>

      {clientError && (
        <section className="error-sheet" role="alert">
          <p className="error-kicker">{strings.status.errorTitle}</p>
          <p>{strings.errors[clientError.kind]}</p>
          {clientError.retryable && lastAction && (
            <button type="button" onClick={retry} disabled={busy !== null}>
              {strings.status.retry}
            </button>
          )}
        </section>
      )}

      {result && (
        <section
          ref={resultRef}
          id="result"
          className="result-sheet"
          aria-labelledby="result-title"
          tabIndex={-1}
        >
          <SectionHeading
            id="result-title"
            number="02"
            title={strings.result.section.slice(5)}
          />
          <article className="normalized-card">
            <h3>{strings.result.normalized}</h3>
            <dl>
              <div>
                <dt>{strings.result.goal}</dt>
                <dd>{result.normalizedBrief.goal}</dd>
              </div>
              <div>
                <dt>{strings.result.deliverable}</dt>
                <dd>{result.normalizedBrief.deliverable}</dd>
              </div>
              <div>
                <dt>{strings.result.detectedType}</dt>
                <dd>{result.normalizedBrief.taskType}</dd>
              </div>
              <div>
                <dt>{strings.result.aspectRatio}</dt>
                <dd>
                  {result.normalizedBrief.aspectRatio.value ??
                    result.normalizedBrief.aspectRatio.mode}
                </dd>
              </div>
            </dl>
            <details className="spec-details">
              <summary>{strings.result.specDetails}</summary>
              <dl>
                <SpecRow
                  term={strings.result.subject}
                  values={[result.normalizedBrief.subject.primary]}
                />
                <SpecRow
                  term={strings.result.hierarchy}
                  values={[result.normalizedBrief.visualHierarchy.primaryFocus]}
                />
                <SpecRow
                  term={strings.result.composition}
                  values={result.normalizedBrief.composition}
                />
                <SpecRow
                  term={strings.result.lighting}
                  values={result.normalizedBrief.lighting}
                />
                <SpecRow
                  term={strings.result.palette}
                  values={[
                    ...result.normalizedBrief.palette.primary,
                    ...result.normalizedBrief.palette.accent,
                  ]}
                />
                <SpecRow
                  term={strings.result.materials}
                  values={result.normalizedBrief.materials}
                />
                <SpecRow
                  term={strings.result.mandatoryText}
                  values={result.normalizedBrief.mandatoryText.map(
                    ({ text }) => text,
                  )}
                />
                <SpecRow
                  term={strings.result.mandatoryElements}
                  values={result.normalizedBrief.mandatoryElements}
                />
                <SpecRow
                  term={strings.result.forbiddenElements}
                  values={result.normalizedBrief.forbiddenElements}
                />
              </dl>
            </details>
          </article>

          <div className="review-grid">
            <InfoList
              title={strings.result.assumptions}
              items={result.normalizedBrief.assumptions.map(
                ({ statement }) => statement,
              )}
              empty={strings.result.noAssumptions}
            />
            <InfoList
              title={strings.result.risks}
              items={risks}
              empty={strings.result.noRisks}
              danger
            />
          </div>

          {result.needsInput ? (
            <p className="notice notice-error" role="alert">
              {strings.result.needsInput}
            </p>
          ) : (
            <div className="direction-list">
              {result.directions.map((direction, index) => (
                <DirectionCard
                  key={`${result.requestId}-${direction.mode}`}
                  index={index + 1}
                  direction={direction}
                  favorite={isFavorite(direction)}
                  copiedKey={copiedKey}
                  busy={busy}
                  preview={previews[direction.mode]}
                  previewError={previewErrors[direction.mode]}
                  previewBusy={previewBusy === direction.mode}
                  previewLocked={previewLocked}
                  revision={revision[direction.mode]}
                  onRevision={(value) =>
                    setRevision((current) => ({
                      ...current,
                      [direction.mode]: value,
                    }))
                  }
                  onCopy={copyPrompt}
                  onFavorite={onFavorite}
                  onRevise={onRevise}
                  onGenerate={generatePreview}
                  onFeedback={applyImageFeedback}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function SectionHeading({
  id,
  number,
  title,
}: {
  id?: string;
  number: string;
  title: string;
}) {
  return (
    <div className="section-heading">
      <span aria-hidden="true">{number}</span>
      <h2 id={id}>{title}</h2>
    </div>
  );
}

function ListField({
  id,
  label,
  hint,
}: {
  id: string;
  label: string;
  hint: string;
}) {
  return (
    <label htmlFor={id}>
      {label}
      <textarea id={id} name={id} rows={2} aria-describedby={`${id}-hint`} />
      <small id={`${id}-hint`}>{hint}</small>
    </label>
  );
}

function InfoList({
  title,
  items,
  empty,
  danger = false,
}: {
  title: string;
  items: string[];
  empty: string;
  danger?: boolean;
}) {
  return (
    <section className={danger ? 'info-list risk-list' : 'info-list'}>
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}

function SpecRow({ term, values }: { term: string; values: string[] }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{values.length ? values.join(' · ') : strings.result.unspecified}</dd>
    </div>
  );
}

function DirectionCard({
  index,
  direction,
  favorite,
  copiedKey,
  busy,
  preview,
  previewError,
  previewBusy,
  previewLocked,
  revision,
  onRevision,
  onCopy,
  onFavorite,
  onRevise,
  onGenerate,
  onFeedback,
}: {
  index: number;
  direction: Direction;
  favorite: boolean;
  copiedKey: string;
  busy: 'compile' | DirectionMode | null;
  preview: GenerateResponse | undefined;
  previewError: ApiClientError | undefined;
  previewBusy: boolean;
  previewLocked: boolean;
  revision: string;
  onRevision(value: string): void;
  onCopy(key: string, prompt: string): Promise<void>;
  onFavorite(direction: Direction): void;
  onRevise(mode: DirectionMode): void;
  onGenerate(direction: Direction): Promise<void>;
  onFeedback(mode: DirectionMode, issue: string, note: string): void;
}) {
  const fullKey = `${direction.mode}-full`;
  const compactKey = `${direction.mode}-compact`;
  const [feedbackIssue, setFeedbackIssue] = useState<string>(
    strings.result.feedbackOptions[0],
  );
  const [feedbackNote, setFeedbackNote] = useState('');
  return (
    <article
      className={`direction-card direction-${direction.mode}`}
      aria-labelledby={`direction-${direction.mode}`}
    >
      <header>
        <p>
          {String(index).padStart(2, '0')} /{' '}
          {strings.result.modes[direction.mode]}
        </p>
        <button type="button" onClick={() => onFavorite(direction)}>
          {favorite ? strings.result.unfavorite : strings.result.favorite}
        </button>
      </header>
      <h3 id={`direction-${direction.mode}`}>{direction.name}</h3>
      <p className="concept">{direction.concept}</p>
      <p className="axis-line">
        <strong>{strings.result.differenceAxes}</strong>
        {direction.differenceAxes.join(' · ')}
      </p>

      <details open>
        <summary>{strings.result.promptFull}</summary>
        <p className="prompt-text">{direction.fullPrompt}</p>
        <button
          type="button"
          className="copy-button"
          onClick={() => void onCopy(fullKey, direction.fullPrompt)}
        >
          {copiedKey === fullKey
            ? strings.result.copied
            : strings.result.copyFull}
        </button>
      </details>
      <details>
        <summary>{strings.result.promptCompact}</summary>
        <p className="prompt-text">{direction.compactPrompt}</p>
        <button
          type="button"
          className="copy-button"
          onClick={() => void onCopy(compactKey, direction.compactPrompt)}
        >
          {copiedKey === compactKey
            ? strings.result.copied
            : strings.result.copyCompact}
        </button>
      </details>

      <div className="direction-meta">
        <InfoList
          title={strings.result.assumptions}
          items={direction.assumptions}
          empty={strings.result.noAssumptions}
        />
        <InfoList
          title={strings.result.risks}
          items={[...direction.riskFlags, ...direction.negativeConstraints]}
          empty={strings.result.noRisks}
          danger
        />
      </div>

      <section className="preview-panel" aria-label={strings.result.preview}>
        <h4>{strings.result.preview}</h4>
        <p className="cost-notice">{strings.result.previewCost}</p>
        {!preview && !previewError && (
          <button
            type="button"
            className="preview-button"
            disabled={busy !== null || previewLocked}
            onClick={() => void onGenerate(direction)}
          >
            {previewBusy
              ? strings.result.previewGenerating
              : strings.result.previewGenerate}
          </button>
        )}
        {previewError && (
          <div className="preview-error" role="alert">
            <p>{strings.errors[previewError.kind]}</p>
            {previewError.retryable && (
              <button
                type="button"
                className="preview-button"
                disabled={busy !== null || previewLocked}
                onClick={() => void onGenerate(direction)}
              >
                {previewBusy
                  ? strings.result.previewGenerating
                  : strings.result.previewRetry}
              </button>
            )}
          </div>
        )}
        {preview && (
          <>
            <img
              className="preview-image"
              src={`data:${preview.image.mimeType};base64,${preview.image.base64}`}
              alt={`${strings.result.modes[direction.mode]}${strings.result.previewAlt}`}
            />
            <p className="preview-meta">
              {preview.image.size} · {preview.usage.model}
            </p>
            <fieldset className="feedback-form">
              <legend>{strings.result.feedbackLegend}</legend>
              <label>
                {strings.result.feedbackIssue}
                <select
                  value={feedbackIssue}
                  onChange={(event) => setFeedbackIssue(event.target.value)}
                >
                  {strings.result.feedbackOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {strings.result.feedbackNote}
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={feedbackNote}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="preview-button"
                onClick={() =>
                  onFeedback(direction.mode, feedbackIssue, feedbackNote)
                }
              >
                {strings.result.feedbackBuild}
              </button>
              <small>{strings.result.feedbackSubmitHint}</small>
            </fieldset>
          </>
        )}
      </section>

      <p className="score-line">
        {strings.result.score}
        <strong>{Math.round(direction.scores.constraintControl)}</strong>
      </p>
      <label htmlFor={`revise-${direction.mode}`}>
        {strings.result.reviseLabel}
        <textarea
          id={`revise-${direction.mode}`}
          value={revision}
          rows={2}
          maxLength={4000}
          placeholder={strings.result.revisePlaceholder}
          onChange={(event) => onRevision(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="revise-button"
        disabled={!revision.trim() || busy !== null}
        onClick={() => onRevise(direction.mode)}
      >
        {busy === direction.mode
          ? strings.result.revising
          : strings.result.revise}
      </button>
    </article>
  );
}

function SupportList<T extends { id: string }>({
  title,
  empty,
  entries,
  label,
  meta,
  action,
  onAction,
  clearLabel,
  onClear,
}: {
  title: string;
  empty: string;
  entries: T[];
  label(entry: T): string;
  meta(entry: T): string;
  action: string;
  onAction(entry: T): void;
  clearLabel: string;
  onClear(): void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <section className="support-panel">
      <div className="support-title">
        <h2 ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              titleRef.current?.focus();
              onClear();
            }}
          >
            {clearLabel}
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{label(entry)}</strong>
                <small>{meta(entry)}</small>
              </div>
              <button type="button" onClick={() => onAction(entry)}>
                {action}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
