import { describe, expect, it } from "vite-plus/test";
import { EventId, TURN_USAGE_ACTIVITY_KIND, TurnId } from "@t3tools/contracts";

import {
  deriveTurnNerdStats,
  deriveTurnNerdStatsByTurnId,
  formatNerdStatsParts,
  formatTimeToFirstToken,
  formatTokensPerSecond,
} from "./nerdStats.ts";

function activity(
  id: string,
  kind: string,
  payload: unknown,
  turnId = "turn-1",
): {
  id: ReturnType<typeof EventId.make>;
  tone: "info";
  kind: string;
  summary: string;
  payload: unknown;
  turnId: ReturnType<typeof TurnId.make>;
  createdAt: string;
} {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make(turnId),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("deriveTurnNerdStats", () => {
  it("combines context window, turn usage, and timing", () => {
    const stats = deriveTurnNerdStats({
      turnId: "turn-1",
      activities: [
        activity("ctx", "context-window.updated", {
          usedTokens: 45_200,
          maxTokens: 128_000,
          lastInputTokens: 1_200,
          lastCachedInputTokens: 400,
          lastOutputTokens: 80,
        }),
        activity("usage", TURN_USAGE_ACTIVITY_KIND, {
          tokenUsage: {
            usageStatus: "complete",
            usageScope: "main_agent",
            hasSubagents: false,
            inputTokens: 1_200,
            outputTokens: 463,
            cachedInputTokens: 400,
          },
          firstContentAt: "2026-03-23T00:00:00.400Z",
          startedAt: "2026-03-23T00:00:00.000Z",
          completedAt: "2026-03-23T00:00:05.720Z",
        }),
      ],
    });

    expect(stats).toMatchObject({
      contextUsedTokens: 45_200,
      contextMaxTokens: 128_000,
      inputTokens: 1_200,
      cachedInputTokens: 400,
      responseTokens: 463,
      timeToFirstTokenMs: 400,
    });
    expect(stats?.contextUsedPercentage).toBeCloseTo(35.3125);
    expect(stats?.tokensPerSecond).toBeCloseTo(463 / 5.32);
    expect(formatNerdStatsParts(stats!)).toEqual([
      "45.2k / 128k (35%)",
      "in 1.2k · 400 cache",
      "463 tokens",
      "87.03 tok/s",
      "TTFT 0.4000s",
    ]);
  });

  it("falls back to context-window last output tokens when turn usage is missing", () => {
    const stats = deriveTurnNerdStats({
      turnId: "turn-1",
      firstContentAt: "2026-03-23T00:00:01.000Z",
      completedAt: "2026-03-23T00:00:03.000Z",
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        requestedAt: "2026-03-23T00:00:00.000Z",
        startedAt: "2026-03-23T00:00:00.200Z",
        completedAt: "2026-03-23T00:00:03.000Z",
      },
      activities: [
        activity("ctx", "context-window.updated", {
          usedTokens: 2_000,
          maxTokens: 8_000,
          lastOutputTokens: 100,
        }),
      ],
    });

    expect(stats).toMatchObject({
      responseTokens: 100,
      timeToFirstTokenMs: 800,
      tokensPerSecond: 50,
    });
  });

  it("ignores other turns and empty payloads", () => {
    expect(
      deriveTurnNerdStats({
        turnId: "turn-2",
        activities: [
          activity("ctx", "context-window.updated", { usedTokens: 10, maxTokens: 100 }, "turn-1"),
          activity("empty", TURN_USAGE_ACTIVITY_KIND, {}, "turn-2"),
        ],
      }),
    ).toBeNull();
  });

  it("indexes the latest snapshot per turn", () => {
    const byTurn = deriveTurnNerdStatsByTurnId({
      activities: [
        activity("ctx-1", "context-window.updated", { usedTokens: 10, maxTokens: 100 }),
        activity("ctx-2", "context-window.updated", { usedTokens: 40, maxTokens: 100 }),
        activity("other", "context-window.updated", { usedTokens: 9, maxTokens: 50 }, "turn-2"),
      ],
    });

    expect(byTurn.get("turn-1")?.contextUsedTokens).toBe(40);
    expect(byTurn.get("turn-2")?.contextUsedTokens).toBe(9);
  });
});

describe("nerd stats formatters", () => {
  it("formats speed and time-to-first-token the way the footer shows them", () => {
    expect(formatTokensPerSecond(86.954)).toBe("86.95 tok/s");
    expect(formatTokensPerSecond(240.2)).toBe("240 tok/s");
    expect(formatTimeToFirstToken(4)).toBe("TTFT 0.0040s");
    expect(formatTimeToFirstToken(1_230)).toBe("TTFT 1.23s");
    expect(formatTimeToFirstToken(12_400)).toBe("TTFT 12.4s");
  });
});
