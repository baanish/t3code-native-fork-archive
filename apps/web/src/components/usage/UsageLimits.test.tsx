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

import { ProviderDriverKind } from "@t3tools/contracts";
import {
  deficitPresentations,
  edgePresentations,
  independentAccountPresentations,
  PACING_FIXTURE_NOW,
  reservePresentations,
  reserveWindows,
  unavailableEstimatePresentations,
} from "@t3tools/shared/testing/usageLimitsFixtures";
import { collectLimitPools, collectLimitAccounts } from "@t3tools/shared/usageLimits";

import { isLimitsPacingMockScene } from "./UsageLimitsPacingHarness";
import { LimitWindows } from "./UsageLimits";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

describe("UsageLimitsPacingHarness", () => {
  it("accepts only the named mock scenes", () => {
    expect(isLimitsPacingMockScene("reserve")).toBe(true);
    expect(isLimitsPacingMockScene("live")).toBe(false);
  });
});

describe("LimitWindows pacing", () => {
  it("renders reserve, even-spend verdict, and session-length windows on weekly", () => {
    const markup = renderToStaticMarkup(
      <LimitWindows
        driver={ProviderDriverKind.make("codex")}
        windows={[...reserveWindows]}
        now={PACING_FIXTURE_NOW}
      />,
    );
    expect(markup).toContain("49% left");
    expect(markup).toContain("24% in reserve");
    expect(markup).toContain("64% left");
    expect(markup).toContain("55% in reserve");
    expect(markup).toContain("41% left");
    expect(markup).toContain("32% in reserve");
    expect(markup).toContain("Even spend lasts until reset");
    expect(markup).toContain("2 full session-length windows");
    expect(markup).not.toContain("35% risk");
    expect(markup).not.toContain("session quotas left");
  });

  it("keeps quota and reset when pace cannot be estimated", () => {
    const markup = renderToStaticMarkup(
      <LimitWindows
        driver={ProviderDriverKind.make("codex")}
        windows={
          unavailableEstimatePresentations().values().next().value!.serverConfig!.providers![0]!
            .usageLimits!.windows
        }
        now={PACING_FIXTURE_NOW}
      />,
    );
    expect(markup).toContain("60% left");
    expect(markup).toContain("resets in");
    expect(markup).not.toContain("in reserve");
    expect(markup).not.toContain("in deficit");
    expect(markup).not.toContain("On pace");
  });
});

describe("UsageLimitsPooled pacing", () => {
  it("shows account-level reserve on a single-account pool", () => {
    const markup = renderToStaticMarkup(
      <UsageLimitsPooled presentations={reservePresentations()} now={PACING_FIXTURE_NOW} />,
    );
    expect(markup).toContain("24% in reserve");
    expect(markup).toContain("Even spend lasts until reset");
    expect(markup).toContain("2 session-length windows until reset");
    expect(markup).toContain("Weekly · Fable");
  });

  it("keeps independent accounts on separate pace readouts", () => {
    const presentations = independentAccountPresentations();
    const pools = collectLimitPools(collectLimitAccounts(presentations), PACING_FIXTURE_NOW);
    expect(pools).toHaveLength(2);
    expect(pools[0]?.windows.some((window) => window.paceDetail?.status === "reserve")).toBe(true);
    expect(pools[1]?.windows.some((window) => window.paceDetail?.status === "deficit")).toBe(true);

    const markup = renderToStaticMarkup(
      <UsageLimitsPooled presentations={presentations} now={PACING_FIXTURE_NOW} />,
    );
    expect(markup).toContain("24% in reserve");
    expect(markup).toContain("20% in deficit");
    expect(markup).toContain("Even spend would run out before reset");
  });

  it("renders deficit, zero, exhausted, and on-pace without NaN", () => {
    const deficit = renderToStaticMarkup(
      <UsageLimitsPooled presentations={deficitPresentations()} now={PACING_FIXTURE_NOW} />,
    );
    const edges = renderToStaticMarkup(
      <UsageLimitsPooled presentations={edgePresentations()} now={PACING_FIXTURE_NOW} />,
    );
    expect(deficit).toContain("20% in deficit");
    expect(edges).toContain("60% in reserve");
    expect(edges).toContain("40% in deficit");
    expect(edges).toContain("On pace");
    expect(deficit + edges).not.toMatch(/NaN|Infinity/);
  });

  it("omits estimates when duration is missing or the window has just opened", () => {
    const markup = renderToStaticMarkup(
      <UsageLimitsPooled
        presentations={unavailableEstimatePresentations()}
        now={PACING_FIXTURE_NOW}
      />,
    );
    expect(markup).toContain("60% left");
    expect(markup).toContain("99% left");
    expect(markup).not.toContain("in reserve");
    expect(markup).not.toContain("in deficit");
  });
});
