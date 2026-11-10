/**
 * WCAG contrast of the colour pairs the console adds on top of the kit (design v2; the kit's own
 * contrast test covers its components). Values are read from the installed kit's light tokens, so a
 * token change that breaks a pair fails here.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const css = readFileSync(require.resolve("@nearpay-internal/ui/tokens.css"), "utf8");
// light theme block: everything before the dark theme override
const light = css.slice(0, css.indexOf('[data-theme="dark"]'));

function token(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(light);
  if (!m?.[1]) throw new Error(`token ${name} not found`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("console colour pairs (≥ 4.5:1 text, ≥ 3:1 UI)", () => {
  const pairs: [string, string, string, number][] = [
    ["Ops badge on the navy sidebar", "--np-violet-on-navy", "--np-navy-raised", 4.5],
    ["Ops badge on light (auth panel)", "--np-color-info-fg", "--np-color-info-bg", 4.5],
    ["kill-switch tile while engaged", "--np-color-danger-fg", "--np-color-danger-bg", 4.5],
    ["quiet danger button (Remove)", "--np-color-danger-fg", "--np-color-surface", 4.5],
    ["restrictive actions heading", "--np-color-danger-fg", "--np-color-surface", 4.5],
    ["single-operator notice", "--np-color-info-fg", "--np-color-info-bg", 4.5],
    ["two-person notice", "--np-color-warning-strong", "--np-color-warning-subtle", 4.5],
    ["payment-reviews tile (warning)", "--np-color-warning-fg", "--np-color-warning-subtle", 4.5],
    ["muted table cells", "--np-color-text-secondary", "--np-color-surface", 4.5],
  ];
  for (const [what, fg, bg, min] of pairs)
    it(what, () => {
      expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
    });
  it("the accent line is visible on the white top bar and the canvas (≥ 3:1)", () => {
    expect(ratio(token("--np-color-route"), token("--np-color-bg"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("--np-color-route"), token("--np-color-surface"))).toBeGreaterThanOrEqual(3);
  });
});
