import {
  TURN_USAGE_ACTIVITY_KIND,
  type OrchestrationThreadActivity,
  type TurnId,
  type TurnTokenUsage,
} from "@t3tools/contracts";

import { formatSubagentTokenCount } from "./subagentRuntime.ts";

const CONTEXT_WINDOW_ACTIVITY_KIND = "context-window.updated";
const MIN_GENERATION_MS_FOR_TOKENS_PER_SECOND = 10;

export interface TurnNerdStats {
  readonly contextUsedTokens: number | null;
  readonly contextMaxTokens: number | null;
  readonly contextUsedPercentage: number | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly responseTokens: number | null;
  readonly tokensPerSecond: number | null;
  readonly timeToFirstTokenMs: number | null;
}

export interface TurnNerdStatsLookup {
  readonly activities: ReadonlyArray<
    Pick<OrchestrationThreadActivity, "kind" | "payload" | "turnId" | "createdAt">
  >;
  readonly latestTurn?: {
    readonly turnId: TurnId | string;
    readonly startedAt: string | null;
    readonly requestedAt?: string | null;
    readonly completedAt: string | null;
  } | null;
}

interface TurnNerdRaw {
  context: ContextWindowBits | null;
  usage: TurnUsageBits | null;
}

interface ContextWindowBits {
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly lastInputTokens: number | null;
  readonly lastCachedInputTokens: number | null;
  readonly lastOutputTokens: number | null;
}

interface TurnUsageBits {
  readonly tokenUsage: TurnTokenUsage | null;
  readonly firstContentAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIsoTime(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseContextWindowBits(payload: unknown): ContextWindowBits | null {
  const record = asRecord(payload);
  const usedTokens = asFiniteNumber(record?.usedTokens);
  if (usedTokens === null || usedTokens < 0) {
    return null;
  }
  return {
    usedTokens,
    maxTokens: asFiniteNumber(record?.maxTokens),
    inputTokens: asFiniteNumber(record?.inputTokens),
    cachedInputTokens: asFiniteNumber(record?.cachedInputTokens),
    outputTokens: asFiniteNumber(record?.outputTokens),
    lastInputTokens: asFiniteNumber(record?.lastInputTokens),
    lastCachedInputTokens: asFiniteNumber(record?.lastCachedInputTokens),
    lastOutputTokens: asFiniteNumber(record?.lastOutputTokens),
  };
}

function parseTokenUsage(value: unknown): TurnTokenUsage | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  if (record.usageScope !== "main_agent") {
    return null;
  }
  if (
    record.usageStatus !== "complete" &&
    record.usageStatus !== "partial" &&
    record.usageStatus !== "unavailable"
  ) {
    return null;
  }
  return record as TurnTokenUsage;
}

function parseTurnUsageBits(payload: unknown): TurnUsageBits | null {
  const record = asRecord(payload);
  if (record === null) {
    return null;
  }
  const tokenUsage = parseTokenUsage(record.tokenUsage);
  const firstContentAt = asIsoTime(record.firstContentAt);
  const startedAt = asIsoTime(record.startedAt);
  const completedAt = asIsoTime(record.completedAt);
  if (
    tokenUsage === null &&
    firstContentAt === null &&
    startedAt === null &&
    completedAt === null
  ) {
    return null;
  }
  return { tokenUsage, firstContentAt, startedAt, completedAt };
}

function emptyRaw(): TurnNerdRaw {
  return { context: null, usage: null };
}

function indexTurnNerdRaw(activities: TurnNerdStatsLookup["activities"]): Map<string, TurnNerdRaw> {
  const byTurnId = new Map<string, TurnNerdRaw>();
  for (const activity of activities) {
    if (activity.turnId === null) {
      continue;
    }
    const turnId = String(activity.turnId);
    if (activity.kind === CONTEXT_WINDOW_ACTIVITY_KIND) {
      const context = parseContextWindowBits(activity.payload);
      if (context === null) {
        continue;
      }
      const raw = byTurnId.get(turnId) ?? emptyRaw();
      raw.context = context;
      byTurnId.set(turnId, raw);
      continue;
    }
    if (activity.kind !== TURN_USAGE_ACTIVITY_KIND) {
      continue;
    }
    const usage = parseTurnUsageBits(activity.payload);
    if (usage === null) {
      continue;
    }
    const raw = byTurnId.get(turnId) ?? emptyRaw();
    raw.usage = usage;
    byTurnId.set(turnId, raw);
  }
  return byTurnId;
}

function resolveResponseTokens(
  usage: TurnUsageBits | null,
  context: ContextWindowBits | null,
): number | null {
  const outputTokens = usage?.tokenUsage?.outputTokens;
  if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
    return outputTokens;
  }
  return context?.lastOutputTokens ?? context?.outputTokens ?? null;
}

function resolveInputTokens(
  usage: TurnUsageBits | null,
  context: ContextWindowBits | null,
): number | null {
  const inputTokens = usage?.tokenUsage?.inputTokens;
  if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
    return inputTokens;
  }
  return context?.lastInputTokens ?? context?.inputTokens ?? null;
}

function resolveCachedInputTokens(
  usage: TurnUsageBits | null,
  context: ContextWindowBits | null,
): number | null {
  const cached = usage?.tokenUsage?.cachedInputTokens;
  if (typeof cached === "number" && Number.isFinite(cached)) {
    return cached;
  }
  return context?.lastCachedInputTokens ?? context?.cachedInputTokens ?? null;
}

function toNerdStats(input: {
  raw: TurnNerdRaw | undefined;
  latestTurn: TurnNerdStatsLookup["latestTurn"];
  turnId: string;
  firstContentAt?: string | null | undefined;
  completedAt?: string | null | undefined;
}): TurnNerdStats | null {
  const raw = input.raw ?? emptyRaw();
  const matchingLatestTurn =
    input.latestTurn && String(input.latestTurn.turnId) === input.turnId ? input.latestTurn : null;
  const context = raw.context;
  const usage = raw.usage;
  const inputTokens = resolveInputTokens(usage, context);
  const cachedInputTokens = resolveCachedInputTokens(usage, context);
  const outputTokens =
    typeof usage?.tokenUsage?.outputTokens === "number" &&
    Number.isFinite(usage.tokenUsage.outputTokens)
      ? usage.tokenUsage.outputTokens
      : (context?.outputTokens ?? null);
  const responseTokens = resolveResponseTokens(usage, context);
  const firstContentAt = usage?.firstContentAt ?? input.firstContentAt ?? null;
  const startedAt =
    usage?.startedAt ?? matchingLatestTurn?.startedAt ?? matchingLatestTurn?.requestedAt ?? null;
  const completedAt =
    usage?.completedAt ?? matchingLatestTurn?.completedAt ?? input.completedAt ?? null;

  const firstContentMs = parseMs(firstContentAt);
  const startedMs = parseMs(startedAt);
  const completedMs = parseMs(completedAt);
  const timeToFirstTokenMs =
    firstContentMs !== null && startedMs !== null && firstContentMs >= startedMs
      ? firstContentMs - startedMs
      : null;
  const generationStartMs = firstContentMs ?? startedMs;
  const generationMs =
    completedMs !== null && generationStartMs !== null && completedMs > generationStartMs
      ? completedMs - generationStartMs
      : null;
  const tokensPerSecond =
    responseTokens !== null &&
    responseTokens > 0 &&
    generationMs !== null &&
    generationMs >= MIN_GENERATION_MS_FOR_TOKENS_PER_SECOND
      ? (responseTokens * 1000) / generationMs
      : null;
  const contextUsedTokens = context?.usedTokens ?? null;
  const contextMaxTokens = context?.maxTokens ?? null;
  const contextUsedPercentage =
    contextUsedTokens !== null && contextMaxTokens !== null && contextMaxTokens > 0
      ? Math.min(100, (contextUsedTokens / contextMaxTokens) * 100)
      : null;

  const stats: TurnNerdStats = {
    contextUsedTokens,
    contextMaxTokens,
    contextUsedPercentage,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    responseTokens,
    tokensPerSecond,
    timeToFirstTokenMs,
  };
  return hasNerdStats(stats) ? stats : null;
}

export function hasNerdStats(stats: TurnNerdStats | null | undefined): stats is TurnNerdStats {
  if (!stats) {
    return false;
  }
  return (
    stats.contextUsedTokens !== null ||
    stats.contextMaxTokens !== null ||
    stats.inputTokens !== null ||
    stats.cachedInputTokens !== null ||
    stats.outputTokens !== null ||
    stats.responseTokens !== null ||
    stats.tokensPerSecond !== null ||
    stats.timeToFirstTokenMs !== null
  );
}

export function deriveTurnNerdStats(
  input: TurnNerdStatsLookup & {
    readonly turnId: TurnId | string | null | undefined;
    readonly firstContentAt?: string | null;
    readonly completedAt?: string | null;
  },
): TurnNerdStats | null {
  if (input.turnId === null || input.turnId === undefined) {
    return null;
  }
  const turnId = String(input.turnId);
  return toNerdStats({
    raw: indexTurnNerdRaw(input.activities).get(turnId),
    latestTurn: input.latestTurn,
    turnId,
    firstContentAt: input.firstContentAt,
    completedAt: input.completedAt,
  });
}

export function deriveTurnNerdStatsByTurnId(
  lookup: TurnNerdStatsLookup,
): Map<string, TurnNerdStats> {
  const rawByTurn = indexTurnNerdRaw(lookup.activities);
  const result = new Map<string, TurnNerdStats>();
  for (const [turnId, raw] of rawByTurn) {
    const stats = toNerdStats({
      raw,
      latestTurn: lookup.latestTurn,
      turnId,
    });
    if (stats) {
      result.set(turnId, stats);
    }
  }
  if (lookup.latestTurn) {
    const latestTurnId = String(lookup.latestTurn.turnId);
    if (!result.has(latestTurnId)) {
      const stats = toNerdStats({
        raw: rawByTurn.get(latestTurnId),
        latestTurn: lookup.latestTurn,
        turnId: latestTurnId,
      });
      if (stats) {
        result.set(latestTurnId, stats);
      }
    }
  }
  return result;
}

export function formatNerdTokenCount(value: number): string {
  return formatSubagentTokenCount(value);
}

export function formatNerdPercent(value: number): string {
  if (value >= 10 || value === 0) {
    return `${Math.round(value)}%`;
  }
  return `${value.toFixed(1)}%`;
}

export function formatTokensPerSecond(value: number): string {
  if (value >= 100) {
    return `${Math.round(value)} tok/s`;
  }
  return `${value.toFixed(2)} tok/s`;
}

export function formatTimeToFirstToken(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) {
    return `TTFT ${seconds.toFixed(4)}s`;
  }
  if (seconds < 10) {
    return `TTFT ${seconds.toFixed(2)}s`;
  }
  return `TTFT ${seconds.toFixed(1)}s`;
}

export function formatNerdStatsParts(stats: TurnNerdStats): string[] {
  const parts: string[] = [];
  if (stats.contextUsedTokens !== null && stats.contextMaxTokens !== null) {
    const context = `${formatNerdTokenCount(stats.contextUsedTokens)} / ${formatNerdTokenCount(stats.contextMaxTokens)}`;
    parts.push(
      stats.contextUsedPercentage !== null
        ? `${context} (${formatNerdPercent(stats.contextUsedPercentage)})`
        : context,
    );
  } else if (stats.contextMaxTokens !== null) {
    parts.push(`${formatNerdTokenCount(stats.contextMaxTokens)} ctx`);
  } else if (stats.contextUsedTokens !== null) {
    parts.push(`${formatNerdTokenCount(stats.contextUsedTokens)} ctx`);
  }

  const usage: string[] = [];
  if (stats.inputTokens !== null) {
    usage.push(`in ${formatNerdTokenCount(stats.inputTokens)}`);
  }
  if (stats.cachedInputTokens !== null && stats.cachedInputTokens > 0) {
    usage.push(`${formatNerdTokenCount(stats.cachedInputTokens)} cache`);
  }
  if (usage.length > 0) {
    parts.push(usage.join(" · "));
  }

  if (stats.responseTokens !== null) {
    parts.push(`${formatNerdTokenCount(stats.responseTokens)} tokens`);
  }
  if (stats.tokensPerSecond !== null) {
    parts.push(formatTokensPerSecond(stats.tokensPerSecond));
  }
  if (stats.timeToFirstTokenMs !== null) {
    parts.push(formatTimeToFirstToken(stats.timeToFirstTokenMs));
  }
  return parts;
}
