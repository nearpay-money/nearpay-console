import { SegmentedControl } from "@nearpay-internal/ui";
import { useApp } from "../app/context";

/** Live / Test switch for mode-scoped lists (INV-8: a list never mixes modes). Kept in the URL. */
export function ModeFilter() {
  const app = useApp();
  return (
    <div className="c-mode-filter">
      <span className="c-mode-filter__label" id="mode-filter-label">
        Mode
      </span>
      <SegmentedControl
        label="Mode"
        size="sm"
        items={[
          { id: "live", label: "Live" },
          { id: "test", label: "Test" },
        ]}
        value={app.mode}
        onChange={(m) => app.setMode(m === "test" ? "test" : "live")}
      />
    </div>
  );
}
