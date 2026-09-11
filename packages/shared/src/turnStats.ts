/**
 * Per-response nerd stats: pure helpers shared by web and mobile.
 *
 * A turn's stats come from two activity kinds:
 * - `turn.stats` (emitted by the server on turn completion): token breakdown,
 *   time-to-first-token, duration, and tokens/sec.
 * - `context-window.updated` (latest row per turn): context usage at the turn's
 *   end, plus a `last*`/`durationMs` fallback for threads that completed
 *   before `turn.stats` existed.
 */

export interface TurnStatsPayload {
  readonly usageStatus: "complete" | "partial" | "unavailable";
  readonly hasSubagents: boolean;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  readonly ttftMs: number | null;
  readonly durationMs: number | null;
  readonly tokensPerSec: number | null;
}

export interface TurnContextRef {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  readonly lastUsedTokens: number | null;
  readonly lastInputTokens: number | null;
  readonly lastOutputTokens: number | null;
  readonly durationMs: number | null;
}

export interface NerdStatsView {
  readonly responseTokens: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly contextUsedTokens: number | null;
  readonly contextMaxTokens: number | null;
  readonly contextUsedPercentage: number | null;
  readonly tokensPerSec: number | null;
  readonly ttftMs: number | null;
  readonly durationMs: number | null;
  readonly hasSubagents: boolean;
}

type ActivityLike = {
  readonly kind: string;
  readonly payload: unknown;
  readonly turnId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseTurnStatsPayload(payload: unknown): TurnStatsPayload | null {
  const record = asRecord(payload);
  if (!record) return null;
  const usageStatus = record.usageStatus;
  if (usageStatus !== "complete" && usageStatus !== "partial" && usageStatus !== "unavailable") {
    return null;
  }
  return {
    usageStatus,
    hasSubagents: record.hasSubagents === true,
    inputTokens: asNonNegativeInt(record.inputTokens),
    outputTokens: asNonNegativeInt(record.outputTokens),
    cachedInputTokens: asNonNegativeInt(record.cachedInputTokens),
    cacheCreationTokens: asNonNegativeInt(record.cacheCreationTokens),
    reasoningTokens: asNonNegativeInt(record.reasoningTokens),
    totalTokens: asNonNegativeInt(record.totalTokens),
    ttftMs: asNonNegativeNumber(record.ttftMs),
    durationMs: asNonNegativeNumber(record.durationMs),
    tokensPerSec: asNonNegativeNumber(record.tokensPerSec),
  };
}

function parseContextRef(payload: unknown): TurnContextRef | null {
  const record = asRecord(payload);
  const usedTokens = asNonNegativeInt(record?.usedTokens);
  if (usedTokens === null) return null;
  const maxTokens = asRecord(payload)?.maxTokens;
  return {
    usedTokens,
    maxTokens:
      typeof maxTokens === "number" && Number.isInteger(maxTokens) && maxTokens > 0
        ? maxTokens
        : null,
    lastUsedTokens: asNonNegativeInt(record?.lastUsedTokens),
    lastInputTokens: asNonNegativeInt(record?.lastInputTokens),
    lastOutputTokens: asNonNegativeInt(record?.lastOutputTokens),
    durationMs: asNonNegativeNumber(record?.durationMs),
  };
}

/**
 * Latest stats row per turn. Callers pass the thread's full activity list;
 * malformed rows are skipped so they never shadow an earlier valid row.
 */
export function deriveTurnStatsMaps(activities: ReadonlyArray<ActivityLike>): {
  readonly statsByTurnId: ReadonlyMap<string, TurnStatsPayload>;
  readonly contextByTurnId: ReadonlyMap<string, TurnContextRef>;
} {
  const statsByTurnId = new Map<string, TurnStatsPayload>();
  const contextByTurnId = new Map<string, TurnContextRef>();
  for (const activity of activities) {
    if (activity.turnId === null) continue;
    if (activity.kind === "turn.stats") {
      const parsed = parseTurnStatsPayload(activity.payload);
      if (parsed) statsByTurnId.set(activity.turnId, parsed);
    } else if (activity.kind === "context-window.updated") {
      const parsed = parseContextRef(activity.payload);
      if (parsed) contextByTurnId.set(activity.turnId, parsed);
    }
  }
  return { statsByTurnId, contextByTurnId };
}

function tokensPerSecFrom(outputTokens: number | null, durationMs: number | null): number | null {
  if (outputTokens === null || durationMs === null || durationMs <= 0) return null;
  return outputTokens / (durationMs / 1000);
}

export function resolveNerdStatsView(input: {
  readonly stats: TurnStatsPayload | null;
  readonly context: TurnContextRef | null;
}): NerdStatsView | null {
  const { stats, context } = input;
  if (!stats && !context) return null;

  const inputTokens = stats?.inputTokens ?? context?.lastInputTokens ?? null;
  const outputTokens = stats?.outputTokens ?? context?.lastOutputTokens ?? null;
  const responseTokens =
    stats?.totalTokens ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null) ??
    stats?.outputTokens ??
    context?.lastUsedTokens ??
    null;
  const durationMs = stats?.durationMs ?? context?.durationMs ?? null;
  const tokensPerSec = stats?.tokensPerSec ?? tokensPerSecFrom(outputTokens, durationMs) ?? null;
  const contextUsedPercentage =
    context?.maxTokens !== null && context?.maxTokens !== undefined && context.maxTokens > 0
      ? Math.min(100, (context.usedTokens / context.maxTokens) * 100)
      : null;

  if (
    responseTokens === null &&
    context === null &&
    tokensPerSec === null &&
    (stats?.ttftMs ?? null) === null &&
    durationMs === null
  ) {
    return null;
  }

  return {
    responseTokens,
    inputTokens,
    outputTokens,
    contextUsedTokens: context?.usedTokens ?? null,
    contextMaxTokens: context?.maxTokens ?? null,
    contextUsedPercentage,
    tokensPerSec,
    ttftMs: stats?.ttftMs ?? null,
    durationMs,
    hasSubagents: stats?.hasSubagents ?? false,
  };
}

export function formatNerdTokens(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatNerdTokensPerSec(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 10) return `${value.toFixed(2)} tok/s`;
  if (value < 100) return `${value.toFixed(1)} tok/s`;
  return `${Math.round(value)} tok/s`;
}

export function formatNerdLatency(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2).replace(/\.?0+$/, "")}s`;
  return `${Math.round(ms / 1_000)}s`;
}

export function formatNerdPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}
