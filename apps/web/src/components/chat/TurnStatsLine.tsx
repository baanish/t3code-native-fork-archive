import { useMemo } from "react";
import type { NerdStatsView } from "@t3tools/shared/turnStats";
import {
  formatNerdLatency,
  formatNerdPercentage,
  formatNerdTokens,
  formatNerdTokensPerSec,
} from "@t3tools/shared/turnStats";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type StatsPart = {
  readonly id: string;
  readonly text: string;
};

/**
 * One-line nerd stats under a settled assistant response. Renders only the
 * parts with data; returns null when nothing is known. A hover tooltip breaks
 * the compact totals down.
 */
export function TurnStatsLine({
  model,
  view,
}: {
  readonly model: string | null;
  readonly view: NerdStatsView;
}) {
  const parts = useMemo(() => {
    const items: StatsPart[] = [];
    if (model) items.push({ id: "model", text: model });
    const context = formatNerdContext(view);
    if (context) items.push({ id: "context", text: context });
    const response = formatNerdResponse(view);
    if (response) items.push({ id: "response", text: response });
    const rate = formatNerdTokensPerSec(view.tokensPerSec);
    if (rate) items.push({ id: "rate", text: rate });
    const ttft = formatNerdLatency(view.ttftMs);
    if (ttft) items.push({ id: "ttft", text: `TTFT ${ttft}` });
    return items;
  }, [model, view]);

  const breakdown = useMemo(() => formatNerdBreakdown(view), [view]);

  if (parts.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger render={<p className="text-muted-foreground/80 text-[11px] tabular-nums" />}>
        <span data-testid="turn-stats-line">
          {parts.map((part, index) => (
            <span key={part.id}>
              {index > 0 ? (
                <span aria-hidden="true" className="mx-1.5 opacity-60">
                  ·
                </span>
              ) : null}
              {part.text}
            </span>
          ))}
          {view.hasSubagents ? <span className="ml-1.5 opacity-80">+subagents</span> : null}
        </span>
      </TooltipTrigger>
      {breakdown ? <TooltipPopup>{breakdown}</TooltipPopup> : null}
    </Tooltip>
  );
}

function formatNerdContext(view: NerdStatsView): string | null {
  const used = formatNerdTokens(view.contextUsedTokens);
  if (!used) return null;
  const max = formatNerdTokens(view.contextMaxTokens);
  const percent = formatNerdPercentage(view.contextUsedPercentage);
  if (max && percent) return `${used}/${max} (${percent})`;
  return `${used} ctx`;
}

function formatNerdResponse(view: NerdStatsView): string | null {
  const total = formatNerdTokens(view.responseTokens);
  if (!total) return null;
  return `${total} tok`;
}

function formatNerdBreakdown(view: NerdStatsView): string | null {
  const lines: string[] = [];
  const input = formatNerdTokens(view.inputTokens);
  const output = formatNerdTokens(view.outputTokens);
  if (input && output) {
    lines.push(`${input} input · ${output} output tokens`);
  }
  const duration = formatNerdLatency(view.durationMs);
  const rate = formatNerdTokensPerSec(view.tokensPerSec);
  if (rate && duration) {
    lines.push(`${rate} over ${duration}`);
  } else if (duration) {
    lines.push(`Turn duration ${duration}`);
  }
  if (view.hasSubagents) {
    lines.push("Includes subagent tokens");
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
