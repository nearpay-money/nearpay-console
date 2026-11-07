/** Review screenshots (1440 and 390 wide) of every main screen: `NP_SHOTS_DIR=… pnpm e2e screens`. */
import { expect, signIn, test } from "./harness";

const DIR = process.env.NP_SHOTS_DIR;

test.describe("screenshots", () => {
  test.skip(!DIR, "set NP_SHOTS_DIR to save screenshots");
  test("main screens", async ({ page, api }) => {
    test.setTimeout(180_000);
    const screens: [string, string, string][] = [
      ["overview", "/", "Operations overview"],
      ["merchants", "/merchants", "Merchants"],
      ["merchant", `/merchants/${api.acme.id}`, "Acme Studio"],
      ["kyb-queue", "/kyb", "Business reviews"],
      ["kyb-case", `/kyb/${api.northstar.id}`, "Business review"],
      ["cases", "/cases", "Cases"],
      ["case", `/cases/${api.heldCase.id}`, "Case"],
      ["holds", "/holds", "Payment holds"],
      ["review", `/executions/${api.held.id}`, "Review"],
      ["refund", `/refunds/${api.refundObj.id}`, "Refund"],
      ["reconciliation", "/reconciliation", "Reconciliation"],
      ["reconciliation-run", `/reconciliation/${api.runs[1]?.id}`, "Orbit Tools"],
      ["sentinel", "/sentinel", "Sentinel"],
      ["findings", "/sentinel?tab=findings", "Sentinel"],
      ["blocklist", "/blocklist", "Blocklist"],
      ["audit", "/audit", "Audit log"],
    ];
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/signin");
    await page.screenshot({ path: `${DIR}/signin-1440.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${DIR}/signin-390.png` });
    await page.goto("/auth/enrol#token=enrol-token-0123456789abcdef");
    await expect(page.getByRole("heading", { name: "Register your security key" })).toBeVisible();
    await page.screenshot({ path: `${DIR}/enrol-390.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${DIR}/enrol-1440.png` });
    await signIn(page, "/");
    for (const [name, path, heading] of screens) {
      for (const w of [1440, 390]) {
        await page.setViewportSize({ width: w, height: w === 1440 ? 1000 : 844 });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `${DIR}/${name}-${w}.png`, fullPage: true });
      }
    }
    // step-up dialog
    api.stepUpUntil = 0;
    await page.goto(`/merchants/${api.orbit.id}`);
    await page.getByRole("button", { name: "Request suspension" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Reason/)
      .fill("Chargebacks");
    await page.getByRole("dialog").getByRole("button", { name: "Request suspension" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm with your security key" })).toBeVisible();
    await page.screenshot({ path: `${DIR}/step-up-390.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${DIR}/step-up-1440.png` });
  });
});
