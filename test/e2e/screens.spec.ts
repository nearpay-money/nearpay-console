/** Review screenshots (1440 and 390 wide) of every main screen: `NP_SHOTS_DIR=… pnpm e2e screens`. */
import { expect, signIn, test } from "./harness";

const DIR = process.env.NP_SHOTS_DIR;

test.describe("screenshots", () => {
  test.skip(!DIR, "set NP_SHOTS_DIR to save screenshots");
  test("main screens", async ({ page, api }) => {
    test.setTimeout(240_000);
    // a pending suspension on a single-operator platform, still in its wait: the approval card's
    // "You are the only operator" notice with the time the requester may complete it
    const nowS = Math.floor(Date.now() / 1000);
    const orbit = api.suspensions.get(api.orbit.id);
    if (orbit)
      orbit.pending_request = Object.assign(
        {
          id: "opa_01jbz9k3m4n5p6q7r8s9t0bbbb" as const,
          object: "ops_approval" as const,
          action: "account.suspend" as const,
          target: { type: "account" as const, id: api.orbit.id },
          reason: "Chargeback pattern reported by partner",
          status: "pending" as const,
          requested_by: { id: api.operator.id, role: "ops_admin" as const },
          requested_at: nowS - 600,
          decided_by: null,
          decided_at: null,
          decision_note: null,
          expires_at: nowS + 86_000,
        },
        { single_operator: { used: false, available_at: nowS + 3000, reason_min_length: 20 } },
      );
    const screens: [string, string, string][] = [
      ["overview", "/", "Operations overview"],
      ["merchants", "/merchants", "Merchants"],
      ["merchant", `/merchants/${api.acme.id}`, "Acme Studio"],
      ["approvals", `/merchants/${api.orbit.id}`, "Orbit Tools"],
      ["businesses", "/kyb", "Businesses"],
      ["business-detail", `/kyb/${api.acme.id}`, "Business KY"],
      ["cases", "/cases", "Cases"],
      ["case", `/cases/${api.heldCase.id}`, "Case"],
      ["holds", "/holds", "Payment holds"],
      ["execution-review", `/executions/${api.held.id}`, "Review"],
      ["execution-detail", `/executions/${api.succeeded.id}`, "Execution"],
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
    // empty and error states
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/holds?mode=test");
    await expect(page.getByText("No test payments are held.", { exact: false })).toBeVisible();
    await page.screenshot({ path: `${DIR}/empty-holds-1440.png`, fullPage: true });
    await page.goto("/not-a-page");
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
    await page.screenshot({ path: `${DIR}/not-found-1440.png` });
    // step-up dialog
    api.stepUpUntil = 0;
    await page.goto(`/merchants/${api.acme.id}`);
    await page.getByRole("button", { name: "Request suspension" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Reason/)
      .fill("Chargebacks");
    await page.getByRole("dialog").getByRole("button", { name: "Request suspension" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm with your security key" })).toBeVisible();
    // let the dialog transitions settle (finite animations only: the busy spinner runs forever)
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
          .map((a) => a.finished),
      ),
    );
    await page.screenshot({ path: `${DIR}/step-up-1440.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${DIR}/step-up-390.png` });
  });
});
