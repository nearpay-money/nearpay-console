import { OP_OTHER } from "./fixtures";
import { confirmStepUp, expect, signIn, test } from "./harness";

test.describe("overview and merchants", () => {
  test("overview: stats, one queue, recorded-actions callout", async ({ page, api }) => {
    await signIn(page, "/");
    await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
    await expect(page.getByText("Payment reviews")).toBeVisible();
    await expect(page.getByText("1 exception")).toBeVisible();
    const table = page.getByRole("table", { name: "Cases needing attention" });
    await expect(table.getByRole("row")).toHaveCount(5); // header + 3 cases + 1 business review
    await expect(table.getByText("Payment needs review")).toBeVisible();
    await expect(table.getByText("Business details review")).toBeVisible();
    await expect(page.getByText("Operational actions are recorded")).toBeVisible();
    expect(api.callsTo("listOpsExecutions")[0]?.query).toMatchObject({ livemode: "true", state: "held" });
  });

  test("search, detail, suspension with step-up replay and the two-person rule", async ({ page, api }) => {
    await signIn(page, "/merchants");
    await page.getByLabel("Search").fill("Orb");
    await expect(page.getByRole("table", { name: "Merchants" }).getByRole("row")).toHaveCount(2);
    expect(api.callsTo("listOpsMerchants").at(-1)?.query.q).toBe("Orb");
    await page.getByRole("link", { name: /Orbit Tools/ }).click();
    await expect(page.getByRole("heading", { name: "Orbit Tools", level: 1 })).toBeVisible();

    // request suspension: the step-up is asked and the request replayed with the same Idempotency-Key
    api.stepUpUntil = 0;
    await page.getByRole("button", { name: "Request suspension" }).click();
    const dlg = page.getByRole("dialog", { name: /Request suspending Orbit Tools/ });
    await dlg.getByLabel(/Reason/).fill("Chargeback pattern reported by partner");
    await dlg.getByRole("button", { name: "Request suspension" }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Suspend account requested")).toBeVisible();
    const reqs = api.callsTo("createOpsSuspensionRequest");
    expect(reqs).toHaveLength(2);
    expect(reqs[0]?.headers["idempotency-key"]).toBeTruthy();
    expect(reqs[1]?.headers["idempotency-key"]).toBe(reqs[0]?.headers["idempotency-key"]);
    await expect(page.getByText("A different operator must approve.")).toBeVisible();

    // the requester tries to approve: the server answers approver_conflict
    await page.getByRole("button", { name: "Approve and suspend" }).first().click();
    const approve = page.getByRole("dialog", { name: "Approve and suspend" });
    await approve.getByRole("button", { name: "Approve and suspend" }).click();
    await expect(approve.getByRole("alert")).toContainText("A different operator must approve");
    await approve.getByRole("button", { name: "Cancel" }).click();

    // a second ops admin approves
    api.operator = OP_OTHER;
    await page.reload();
    await page.getByRole("button", { name: "Approve and suspend" }).first().click();
    await page
      .getByRole("dialog", { name: "Approve and suspend" })
      .getByRole("button", { name: "Approve and suspend" })
      .click();
    await expect(page.getByRole("heading", { name: "Orbit Tools" }).locator("..").getByText("Suspended")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request reinstatement" })).toBeVisible();
  });

  test("single-operator platform: the only admin completes their own request with a written reason", async ({
    page,
    api,
  }) => {
    api.singleOperator = true;
    await signIn(page, "/merchants");
    await page.getByRole("link", { name: /Orbit Tools/ }).click();
    await page.getByRole("button", { name: "Request suspension" }).click();
    const dlg = page.getByRole("dialog", { name: /Request suspending Orbit Tools/ });
    await dlg.getByLabel(/Reason/).fill("Chargeback pattern reported by partner");
    await dlg.getByRole("button", { name: "Request suspension" }).click();
    await expect(page.getByText("You are the only operator.")).toBeVisible();
    await expect(page.getByText("A different operator must approve.")).toHaveCount(0);

    await page.getByRole("button", { name: "Approve and suspend" }).first().click();
    const approve = page.getByRole("dialog", { name: "Approve and suspend" });
    await approve.getByLabel(/Reason/).fill("too short");
    await approve.getByRole("button", { name: "Approve and suspend" }).click();
    await expect(approve.getByText(/Write at least 20 characters/)).toBeVisible();
    expect(api.callsTo("approveOpsSuspensionRequest")).toHaveLength(0);
    await approve.getByLabel(/Reason/).fill("Only operator: partner evidence reviewed and confirmed");
    await approve.getByRole("button", { name: "Approve and suspend" }).click();
    await expect(page.getByRole("heading", { name: "Orbit Tools" }).locator("..").getByText("Suspended")).toBeVisible();
    expect(api.callsTo("approveOpsSuspensionRequest").at(-1)?.body).toMatchObject({
      note: "Only operator: partner evidence reviewed and confirmed",
    });
  });

  test("Cloudflare Access mode: a sensitive action asks to sign in again instead of a security key", async ({
    page,
    api,
  }) => {
    api.accessMode = true;
    await signIn(page, "/merchants");
    await page.getByRole("link", { name: /Orbit Tools/ }).click();
    api.stepUpUntil = 0;
    await page.getByRole("button", { name: "Request suspension" }).click();
    const dlg = page.getByRole("dialog", { name: /Request suspending Orbit Tools/ });
    await dlg.getByLabel(/Reason/).fill("Chargeback pattern reported by partner");
    await dlg.getByRole("button", { name: "Request suspension" }).click();
    const reauth = page.getByRole("dialog", { name: "Sign in again to confirm" });
    await expect(reauth).toBeVisible();
    await expect(reauth.getByRole("button", { name: "Sign in again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm with security key" })).toHaveCount(0);
    await reauth.getByRole("button", { name: "Cancel" }).click();
    await expect(reauth).toHaveCount(0);
  });

  test("an ops operator can request but not approve", async ({ page, api }) => {
    api.role = "ops";
    const s = api.suspensions.get(api.orbit.id);
    if (s)
      s.pending_request = {
        id: "opa_01jbz9k3m4n5p6q7r8s9t0aaaa",
        object: "ops_approval",
        action: "account.suspend",
        target: { type: "account", id: api.orbit.id },
        reason: "Reported fraud",
        status: "pending",
        requested_by: { id: OP_OTHER.id, role: "ops_admin" },
        requested_at: Math.floor(Date.now() / 1000) - 60,
        decided_by: null,
        decided_at: null,
        decision_note: null,
        expires_at: Math.floor(Date.now() / 1000) + 86_000,
      };
    await signIn(page, `/merchants/${api.orbit.id}`);
    await expect(page.getByRole("button", { name: "Approve and suspend" })).toBeDisabled();
    await expect(page.getByText("Only an ops admin can do this.").first()).toBeVisible();
  });
});
