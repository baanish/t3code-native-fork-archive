/**
 * Explicit development-only mount for Limits pacing screenshots.
 * Not linked from the production app entry.
 */
import { createRoot } from "react-dom/client";

import "./index.css";
import {
  isLimitsPacingMockScene,
  UsageLimitsPacingHarness,
  type LimitsPacingMockScene,
} from "./components/usage/UsageLimitsPacingHarness";
import { TooltipProvider } from "./components/ui/tooltip";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const sceneParam = params.get("scene");
const scene: LimitsPacingMockScene = isLimitsPacingMockScene(sceneParam) ? sceneParam : "reserve";

document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.dataset.themeId = "t3-chat";
document.documentElement.dataset.themeSelected = "true";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <AppAtomRegistryProvider>
    <TooltipProvider>
      <div className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-medium">Usage → Limits pacing</h1>
            <p className="text-xs text-muted-foreground">
              MOCK DATA · scene={scene} · theme={theme}
            </p>
          </header>
          <UsageLimitsPacingHarness scene={scene} />
        </div>
      </div>
    </TooltipProvider>
  </AppAtomRegistryProvider>,
);
