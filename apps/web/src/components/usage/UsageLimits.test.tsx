import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettings: () => "relative",
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children: ReactNode;
    render?: ReactElement<{ children?: ReactNode }>;
  }) => <span {...render?.props}>{children}</span>,
  TooltipPopup: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    children,
    render,
    ...props
  }: {
    children?: ReactNode;
    render?: ReactElement<{ children?: ReactNode }>;
  }) => (
    <div {...render?.props} {...props}>
      {children}
    </div>
  ),
  PopoverPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../chat/ProviderInstanceIcon", () => ({
  ProviderInstanceIcon: () => <span>icon</span>,
}));

vi.mock("../settings/providerDriverMeta", () => ({
  getDriverOption: (driver: string) => ({ label: driver === "claudeAgent" ? "Claude" : "Codex" }),
}));

vi.mock("../settings/RedactedSensitiveText", () => ({
  RedactedSensitiveText: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("../ui/button", () => ({ Button: "button" }));

import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";

import { LimitWindows } from "./UsageLimits";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const CHECKED_AT = "2026-09-03T11:55:00.000Z";

/** 49% left, 1h 15m of a 5h window → 24% reserve. */
const reserveSession = {
  id: "primary",
  kind: "session",
  label: "Session",
  usedPercent: 51,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T13:15:00.000Z",
} as const satisfies ServerProviderUsageWindow;

/** 20% left, 2h of a 5h window → 20% deficit. */
const deficitSession = {
  ...reserveSession,
  usedPercent: 80,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const satisfies ServerProviderUsageWindow;

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

function presentations(providers: readonly ServerProvider[]) {
  return new Map([
    [
      EnvironmentId.make("env-a"),
      { entry: { target: { label: "Laptop" } }, serverConfig: { providers } },
    ],
  ]);
}

describe("LimitWindows pacing", () => {
  it("renders reserve copy and a pace mark without reset verdicts", () => {
    const markup = renderToStaticMarkup(
      <LimitWindows
        driver={ProviderDriverKind.make("claudeAgent")}
        windows={[reserveSession]}
        now={NOW}
      />,
    );
    expect(markup).toContain("49% left");
    expect(markup).toContain("24% in reserve");
    expect(markup).toContain("data-pace-mark");
    expect(markup).toContain("h-[120%] w-0.5");
    expect(markup).toContain("top-[-10%]");
    expect(markup).not.toContain("until reset");
  });

  it("keeps quota and reset when duration is missing", () => {
    const markup = renderToStaticMarkup(
      <LimitWindows
        driver={ProviderDriverKind.make("codex")}
        windows={[{ ...reserveSession, windowDurationMins: undefined }]}
        now={NOW}
      />,
    );
    expect(markup).toContain("49% left");
    expect(markup).toContain("resets in");
    expect(markup).not.toContain("in reserve");
    expect(markup).not.toContain("in deficit");
  });
});

describe("UsageLimitsPooled pacing", () => {
  it("shows account-level reserve on a single-account pool and keeps the account row", () => {
    const markup = renderToStaticMarkup(
      <UsageLimitsPooled
        presentations={presentations([
          provider({
            instanceId: ProviderInstanceId.make("claude"),
            driver: ProviderDriverKind.make("claudeAgent"),
            displayName: "Personal",
            usageLimits: { checkedAt: CHECKED_AT, windows: [reserveSession] },
          }),
        ])}
        now={NOW}
      />,
    );
    expect(markup).toContain("24% in reserve");
    expect(markup).toContain("data-pace-readout");
    expect(markup).toContain('data-pace-mark="reserve"');
    expect(markup).toContain("data-account-legend");
    expect(markup).toContain("Personal");
  });

  it("keeps independent Claude reserve and Codex deficit on separate cards", () => {
    const markup = renderToStaticMarkup(
      <UsageLimitsPooled
        presentations={presentations([
          provider({
            instanceId: ProviderInstanceId.make("claude"),
            driver: ProviderDriverKind.make("claudeAgent"),
            displayName: "Personal",
            usageLimits: { checkedAt: CHECKED_AT, windows: [reserveSession] },
          }),
          provider({
            displayName: "Work",
            usageLimits: { checkedAt: CHECKED_AT, windows: [deficitSession] },
          }),
        ])}
        now={NOW}
      />,
    );
    expect(markup).toContain("24% in reserve");
    expect(markup).toContain("20% in deficit");
  });
});
