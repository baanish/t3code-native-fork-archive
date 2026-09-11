import { describe, expect, it } from "vite-plus/test";
import {
  deriveTurnStatsMaps,
  formatNerdLatency,
  formatNerdTokens,
  formatNerdTokensPerSec,
  parseTurnStatsPayload,
  resolveNerdStatsView,
} from "./turnStats.ts";

describe("parseTurnStatsPayload", () => {
  it("rejects unknown usage statuses", () => {
    expect(parseTurnStatsPayload({ usageStatus: "bogus" })).toBeNull();
    expect(parseTurnStatsPayload(null)).toBeNull();
  });

  it("parses a complete payload and drops negative counts", () => {
    const parsed = parseTurnStatsPayload({
      usageStatus: "complete",
      hasSubagents: true,
      inputTokens: 100,
      outputTokens: -5,
      totalTokens: 463,
      ttftMs: 4,
      durationMs: 5321,
      tokensPerSec: 86.95,
    });
    expect(parsed).toMatchObject({
      usageStatus: "complete",
      hasSubagents: true,
      inputTokens: 100,
      outputTokens: null,
      totalTokens: 463,
      ttftMs: 4,
      tokensPerSec: 86.95,
    });
  });
});

describe("deriveTurnStatsMaps", () => {
  it("keeps the latest row per turn and skips malformed rows", () => {
    const { statsByTurnId, contextByTurnId } = deriveTurnStatsMaps([
      {
        kind: "turn.stats",
        turnId: "turn-1",
        payload: { usageStatus: "complete", inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
      {
        kind: "turn.stats",
        turnId: "turn-1",
        payload: { usageStatus: "bogus" },
      },
      {
        kind: "context-window.updated",
        turnId: "turn-1",
        payload: { usedTokens: 100, maxTokens: 1000 },
      },
      { kind: "turn.stats", turnId: null, payload: { usageStatus: "complete" } },
    ]);
    expect(statsByTurnId.get("turn-1")).toMatchObject({ totalTokens: 3 });
    expect(contextByTurnId.get("turn-1")).toMatchObject({ usedTokens: 100, maxTokens: 1000 });
  });
});

describe("resolveNerdStatsView", () => {
  it("returns null without any source", () => {
    expect(resolveNerdStatsView({ stats: null, context: null })).toBeNull();
  });

  it("prefers turn.stats and derives tok/s from output over duration", () => {
    const view = resolveNerdStatsView({
      stats: {
        usageStatus: "complete",
        hasSubagents: false,
        inputTokens: 300,
        outputTokens: 163,
        cachedInputTokens: null,
        cacheCreationTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        ttftMs: 40,
        durationMs: 2000,
        tokensPerSec: null,
      },
      context: {
        usedTokens: 12_300,
        maxTokens: 200_000,
        lastUsedTokens: 999,
        lastInputTokens: 1,
        lastOutputTokens: 2,
        durationMs: 9999,
      },
    });
    expect(view).toMatchObject({
      responseTokens: 463,
      inputTokens: 300,
      outputTokens: 163,
      contextUsedTokens: 12_300,
      contextMaxTokens: 200_000,
      ttftMs: 40,
      durationMs: 2000,
    });
    expect(view?.tokensPerSec).toBeCloseTo(81.5, 5);
    expect(view?.contextUsedPercentage).toBeCloseTo(6.15, 5);
  });

  it("falls back to context-window last* counts for pre-stats threads", () => {
    const view = resolveNerdStatsView({
      stats: null,
      context: {
        usedTokens: 5000,
        maxTokens: null,
        lastUsedTokens: 463,
        lastInputTokens: 300,
        lastOutputTokens: 163,
        durationMs: 2000,
      },
    });
    expect(view).toMatchObject({
      responseTokens: 463,
      ttftMs: null,
      durationMs: 2000,
    });
    expect(view?.tokensPerSec).toBeCloseTo(81.5, 5);
  });
});

describe("formatters", () => {
  it("compacts token counts", () => {
    expect(formatNerdTokens(463)).toBe("463");
    expect(formatNerdTokens(12_300)).toBe("12k");
    expect(formatNerdTokens(null)).toBeNull();
  });

  it("formats tok/s with adaptive precision", () => {
    expect(formatNerdTokensPerSec(86.95)).toBe("87.0 tok/s");
    expect(formatNerdTokensPerSec(4.123)).toBe("4.12 tok/s");
    expect(formatNerdTokensPerSec(null)).toBeNull();
  });

  it("formats latency compactly", () => {
    expect(formatNerdLatency(4)).toBe("4ms");
    expect(formatNerdLatency(1500)).toBe("1.5s");
    expect(formatNerdLatency(null)).toBeNull();
  });
});
