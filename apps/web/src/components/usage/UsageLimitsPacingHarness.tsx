/**
 * Development-only mount for Usage → Limits pacing screenshots. Gated on
 * `import.meta.env.DEV` and `?limitsPacingMock=`; never a production fallback.
 */
import {
  deficitPresentations,
  edgePresentations,
  independentAccountPresentations,
  PACING_FIXTURE_NOW,
  reservePresentations,
  unavailableEstimatePresentations,
  type LimitsPresentationMap,
} from "@t3tools/shared/testing/usageLimitsFixtures";

import { UsageLimitsPooled } from "./UsageLimitsPooled";

const SCENES = {
  reserve: reservePresentations,
  deficit: deficitPresentations,
  independent: independentAccountPresentations,
  unavailable: unavailableEstimatePresentations,
  edges: edgePresentations,
} as const;

export type LimitsPacingMockScene = keyof typeof SCENES;

export function isLimitsPacingMockScene(value: string | null): value is LimitsPacingMockScene {
  return value !== null && value in SCENES;
}

export function UsageLimitsPacingHarness({ scene }: { readonly scene: LimitsPacingMockScene }) {
  const presentations: LimitsPresentationMap = SCENES[scene]();
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        MOCK DATA — development harness. Clock frozen at{" "}
        {new Date(PACING_FIXTURE_NOW).toISOString()}. Live provider validation is unavailable in
        this environment.
      </p>
      <UsageLimitsPooled presentations={presentations} now={PACING_FIXTURE_NOW} />
    </div>
  );
}
