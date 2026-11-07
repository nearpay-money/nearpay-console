import { readFile } from "node:fs/promises";
import { OP_OTHER } from "./fixtures";
import { confirmStepUp, expect, signIn, test } from "./harness";

test.describe("holds, sentinel, reconciliation, audit", () => {
  test("payment holds → review: evidence checks, no mark-paid override, reverify never forces a state", async ({
    page,
    api,
  }) => {
    await signIn(page, "/holds");
    const table = page.getByRole("table", { name: "Held payments" });
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByText("249.00 USDC")).toBeVisible();
    await table.getByRole("link", { name: /^RV–/ }).click();
    await expect(page.getByRole("heading", { name: /^Review RV–/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "249.00 USDC payment under review" })).toBeVisible();
    const checks = page.getByRole("table", { name: "Evidence checks" });
    await expect(checks.getByText("Payer transfer")).toBeVisible();
    await expect(checks.getByText("Detected")).toBeVisible();
    await expect(checks.getByText("Pending")).toBeVisible();
    await expect(checks.getByText("Review state delivered")).toBeVisible();
    await expect(page.getByText("No “mark paid” override")).toBeVisible();
    await expect(page.getByRole("button", { name: /mark paid/i })).toHaveCount(0);

    // a note is required
    await page.getByRole("button", { name: "Request investigation" }).click();
    await expect(page.getByText("Add the evidence you checked")).toBeVisible();
    expect(api.callsTo("reverifyOpsExecution")).toHaveLength(0);

    api.stepUpUntil = 0;
    await page.getByLabel("Decision note").fill("Deposit seen on Base; settlement tx missing from tracker.");
    await page.getByRole("button", { name: "Request investigation" }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Investigation requested")).toBeVisible();
    const calls = api.callsTo("reverifyOpsExecution");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers["idempotency-key"]).toBe(calls[0]?.headers["idempotency-key"]);
    // still held: only evidence moves it
    await expect(page.getByRole("heading", { name: /^Review RV–/ })).toBeVisible();
    await expect(page.getByText("Operator re-check").first()).toBeVisible();

    // escalate the linked case
    await page.getByLabel("Decision note").fill("Needs provider ticket.");
    await page.getByRole("button", { name: "Escalate case" }).click();
    await expect(page.getByRole("heading", { name: /^Case RV–/ })).toBeVisible();
    await expect(page.getByText(/Escalated from review RV–/).first()).toBeVisible();
  });

  test("the explorer never mixes modes", async ({ page, api }) => {
    await signIn(page, "/holds");
    await page.getByRole("radio", { name: "Test" }).first().click();
    await expect(page).toHaveURL(/mode=test/);
    await expect(page.getByText("No test payments are held.", { exact: false })).toBeVisible();
    expect(api.callsTo("listOpsExecutions").at(-1)?.query.livemode).toBe("false");
  });

  test("kill switch: one operator engages; release needs a different ops admin", async ({ page, api }) => {
    await signIn(page, "/sentinel");
    await page.getByRole("button", { name: "Engage kill switch" }).click();
    const eng = page.getByRole("dialog", { name: "Engage the kill switch" });
    await eng.getByLabel(/Reason/).fill("Provider returning stale quotes");
    await eng.getByRole("button", { name: "Engage now" }).click();
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
    expect(api.callsTo("engageOpsKillSwitch")[0]?.headers["idempotency-key"]).toBeTruthy();

    api.stepUpUntil = 0;
    await page.getByRole("button", { name: "Request release" }).click();
    const rel = page.getByRole("dialog", { name: "Request releasing the kill switch" });
    await rel.getByLabel(/Why it is safe/).fill("Provider fixed the quote cache");
    await rel.getByRole("button", { name: "Request release" }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Release kill switch requested")).toBeVisible();
    await page.getByRole("button", { name: "Approve release" }).click();
    const ap = page.getByRole("dialog", { name: "Approve release" });
    await ap.getByRole("button", { name: "Approve release" }).click();
    await expect(ap.getByRole("alert")).toContainText("A different operator must approve");
    await ap.getByRole("button", { name: "Cancel" }).click();

    api.operator = OP_OTHER;
    await page.reload();
    await page.getByRole("button", { name: "Approve release" }).click();
    await page
      .getByRole("dialog", { name: "Approve release" })
      .getByRole("button", { name: "Approve release" })
      .click();
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
  });

  test("findings: list and acknowledge", async ({ page, api }) => {
    await signIn(page, "/sentinel?tab=findings");
    await page.getByRole("link", { name: /^AU–/ }).click();
    await page.getByRole("button", { name: "Acknowledge" }).click();
    const dlg = page.getByRole("dialog", { name: /Acknowledge AU–/ });
    await dlg.getByLabel(/Note/).fill("Case opened with provider");
    await dlg.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByText("Case opened with provider")).toBeVisible();
    expect(api.findings[0]?.acknowledged_at).not.toBeNull();
  });

  test("reconciliation: stats, export CSV, resolve with step-up, open days are refused", async ({ page, api }) => {
    await signIn(page, "/reconciliation");
    await expect(page.getByRole("heading", { name: "Reconciliation", level: 1 })).toBeVisible();
    await expect(page.getByText("280", { exact: true })).toBeVisible(); // matched payments
    const table = page.getByRole("table", { name: "Reconciliation runs" });
    await expect(table.getByText("Orbit Tools")).toBeVisible();
    await expect(table.getByText("249.00 USDC")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export report" }).click(),
    ]);
    const csv = await readFile((await download.path()) as string, "utf8");
    expect(csv.split("\r\n")[0]).toMatch(/^run_id,day,account_id,merchant,livemode,status,asset/);
    expect(csv).toContain("8300000000,8051000000,249000000");
    expect(csv).toContain("Orbit Tools");

    await table.getByRole("link", { name: /Orbit Tools/ }).click();
    api.stepUpUntil = 0;
    await page.getByRole("button", { name: "Resolve with evidence" }).click();
    const dlg = page.getByRole("dialog", { name: /Resolve RC–/ });
    await dlg.getByLabel("Classification").selectOption("missed_event");
    await dlg.getByLabel(/What was found and done/).fill("Backfilled the missing settlement observation.");
    await dlg.getByRole("button", { name: "Record resolution" }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Missed event")).toBeVisible();

    await page.getByRole("navigation", { name: "Operations" }).getByRole("link", { name: "Reconciliation" }).click();
    await page.getByRole("button", { name: "Run reconciliation" }).click();
    const run = page.getByRole("dialog", { name: "Run reconciliation" });
    await run.getByLabel(/Merchant account id/).fill(api.acme.id);
    await run.getByLabel("Day (UTC)").fill(new Date().toISOString().slice(0, 10));
    await run.getByRole("button", { name: "Start run" }).click();
    await expect(run.getByRole("alert")).toContainText("has not ended yet");
  });

  test("audit log: one trail including this operator's actions", async ({ page, api }) => {
    await signIn(page, "/blocklist");
    await page.getByRole("button", { name: "Block an address" }).click();
    const dlg = page.getByRole("dialog", { name: "Block an address" });
    await dlg.getByRole("textbox", { name: /^Address/ }).fill("0x00000000000000000000000000000000000000bb");
    await dlg.getByLabel(/Reason/).fill("Test entry");
    await dlg.getByRole("button", { name: "Block address" }).click();
    await page.getByRole("navigation", { name: "Operations" }).getByRole("link", { name: "Audit log" }).click();
    const table = page.getByRole("table", { name: "Audit events" });
    await expect(table.getByText("blocklist.added")).toBeVisible();
    await expect(table.getByText("You", { exact: true })).toBeVisible();
    await page.getByLabel("Actor type").selectOption("operator");
    await expect.poll(() => api.callsTo("listOpsAuditEvents").at(-1)?.query.actor_type).toBe("operator");
  });
});
