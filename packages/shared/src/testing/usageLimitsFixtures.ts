/**
 * Deterministic Usage → Limits snapshots for tests and the development-only
 * pacing harness. Values are built from the even-spend formula so reserve,
 * deficit, and missing-data rows stay reproducible. Not a production fallback.
 *
 * @module testing/usageLimitsFixtures
 */
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Frozen clock the fixture windows are measured against. */
export const PACING_FIXTURE_NOW = Date.parse("2026-09-10T12:00:00.000Z");
const CHECKED_AT = "2026-09-10T11:55:00.000Z";
const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;

function isoAfter(ms: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(PACING_FIXTURE_NOW + ms));
}

function windowOf(
  input: Pick<ServerProviderUsageWindow, "id" | "kind" | "label" | "usedPercent"> &
    Partial<Pick<ServerProviderUsageWindow, "resetsAt" | "windowDurationMins">>,
): ServerProviderUsageWindow {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    usedPercent: input.usedPercent,
    ...(input.resetsAt !== undefined ? { resetsAt: input.resetsAt } : {}),
    ...(input.windowDurationMins !== undefined
      ? { windowDurationMins: input.windowDurationMins }
      : {}),
  };
}

/**
 * Claude-shaped session: 49% left, 1h 15m of a 5h window → 24% reserve.
 * Weekly: 64% left, 14h 55m of a 7d window → 55% reserve.
 * Model-specific weekly (Fable): 41% left on the same clock → 32% reserve.
 */
export const reserveWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 51,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter(75 * 60_000),
  }),
  windowOf({
    id: "secondary",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 36,
    windowDurationMins: WEEK_MINS,
    resetsAt: isoAfter((14 * 60 + 55) * 60_000),
  }),
  windowOf({
    id: "seven_day_fable",
    kind: "weekly",
    label: "Weekly · Fable",
    usedPercent: 59,
    windowDurationMins: WEEK_MINS,
    resetsAt: isoAfter((14 * 60 + 55) * 60_000),
  }),
] as const;

/** Mid-window deficit: 60% elapsed, 80% used → 20% deficit. */
const deficitWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 80,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter(2 * 60 * 60_000),
  }),
  windowOf({
    id: "secondary",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 80,
    windowDurationMins: WEEK_MINS,
    resetsAt: isoAfter(3 * 24 * 60 * 60_000),
  }),
] as const;

const onPaceWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 60,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter(2 * 60 * 60_000),
  }),
] as const;

const zeroUsageWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 0,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter(2 * 60 * 60_000),
  }),
] as const;

const exhaustedWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 100,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter(2 * 60 * 60_000),
  }),
] as const;

const missingDurationWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 40,
    resetsAt: isoAfter(2 * 60 * 60_000),
  }),
] as const;

const earlyWindowWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 1,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter((5 * 60 - 5) * 60_000),
  }),
] as const;

const expiredWindowWindows = [
  windowOf({
    id: "primary",
    kind: "session",
    label: "Session",
    usedPercent: 40,
    windowDurationMins: SESSION_MINS,
    resetsAt: isoAfter(-60_000),
  }),
] as const;

function provider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

export type LimitsPresentationMap = Map<
  EnvironmentId,
  {
    readonly entry: { readonly target: { readonly label: string } };
    readonly serverConfig: {
      readonly providers?: readonly ServerProvider[] | undefined;
    } | null;
  }
>;

function presentation(
  environmentId: string,
  label: string,
  providers: readonly ServerProvider[],
): LimitsPresentationMap {
  return new Map([
    [
      EnvironmentId.make(environmentId),
      { entry: { target: { label } }, serverConfig: { providers } },
    ],
  ]);
}

/** Claude reports session, weekly, and model-specific Fable windows. */
export function reservePresentations(): LimitsPresentationMap {
  return presentation("env-a", "Laptop", [
    provider({
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Personal",
      auth: { status: "authenticated", email: "mock-reserve@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...reserveWindows] },
    }),
  ]);
}

/** Independent Claude reserve and Codex deficit so pacing cannot be pooled. */
export function independentAccountPresentations(): LimitsPresentationMap {
  return presentation("env-a", "Laptop", [
    provider({
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Personal",
      auth: { status: "authenticated", email: "mock-reserve@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...reserveWindows] },
    }),
    provider({
      displayName: "Work",
      auth: { status: "authenticated", email: "mock-deficit@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...deficitWindows] },
    }),
  ]);
}

export function deficitPresentations(): LimitsPresentationMap {
  return presentation("env-a", "Laptop", [
    provider({
      displayName: "Personal",
      auth: { status: "authenticated", email: "mock-deficit@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...deficitWindows] },
    }),
  ]);
}

export function unavailableEstimatePresentations(): LimitsPresentationMap {
  return presentation("env-a", "Laptop", [
    provider({
      displayName: "No duration",
      auth: { status: "authenticated", email: "mock-missing@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...missingDurationWindows] },
    }),
    provider({
      instanceId: ProviderInstanceId.make("codex-early"),
      displayName: "Early window",
      auth: { status: "authenticated", email: "mock-early@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...earlyWindowWindows] },
    }),
  ]);
}

export function edgePresentations(): LimitsPresentationMap {
  return presentation("env-a", "Laptop", [
    provider({
      displayName: "Zero",
      auth: { status: "authenticated", email: "mock-zero@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...zeroUsageWindows] },
    }),
    provider({
      instanceId: ProviderInstanceId.make("codex-empty"),
      displayName: "Exhausted",
      auth: { status: "authenticated", email: "mock-exhausted@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...exhaustedWindows] },
    }),
    provider({
      instanceId: ProviderInstanceId.make("codex-on"),
      displayName: "Matched",
      auth: { status: "authenticated", email: "mock-on@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...onPaceWindows] },
    }),
    provider({
      instanceId: ProviderInstanceId.make("codex-expired"),
      displayName: "Expired",
      auth: { status: "authenticated", email: "mock-expired@example.com" },
      usageLimits: { checkedAt: CHECKED_AT, windows: [...expiredWindowWindows] },
    }),
  ]);
}
