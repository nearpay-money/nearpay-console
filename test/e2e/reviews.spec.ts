import { confirmStepUp, expect, signIn, test } from "./harness";

test.describe("KYB, cases, blocklist", () => {
  test("business review: self-declared details, request more info, approve", async ({ page, api }) => {
    await signIn(page, "/kyb");
    await page.getByRole("link", { name: /^KY–/ }).click();
    await expect(page.getByRole("heading", { name: /Business review KY–/ })).toBeVisible();
    await expect(page.getByText("Self-declared", { exact: true })).toBeVisible();
    await expect(page.getByText(/No documents were collected/)).toBeVisible();
    await expect(page.getByText(/verified identity/i)).toHaveCount(0);

    api.stepUpUntil = 0;
    await page.getByRole("button", { name: "Request more info" }).click();
    const dlg = page.getByRole("dialog", { name: "Request more information" });
    await dlg.getByRole("button", { name: "Send request" }).click();
    await expect(dlg.getByText(/Add a internal reason|Add a/)).toBeVisible();
    await dlg.getByLabel(/What the merchant must add/).fill("Upload-free: correct the registration number.");
    await dlg.getByLabel(/Internal reason/).fill("Number has 7 digits");
    await dlg.getByRole("button", { name: "Send request" }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Information requested from the merchant")).toBeVisible();
    const d = api.callsTo("decideOpsKybCase").at(-1)?.body as Record<string, string>;
    expect(d).toEqual({
      decision: "needs_info",
      reason: "Number has 7 digits",
      requested_info: "Upload-free: correct the registration number.",
    });
    await expect(page.getByRole("button", { name: "Approve details" })).toBeDisabled();
  });

  test("cases: assign, note, close", async ({ page, api }) => {
    await signIn(page, `/cases/${api.heldCase.id}`);
    await expect(page.getByRole("heading", { name: /Case RV–/ })).toBeVisible();
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByRole("button", { name: "Unassign me" })).toBeVisible();
    await page.getByLabel("Note", { exact: true }).fill("Asked the provider for the settlement tx.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText(/Asked the provider for the settlement tx/).first()).toBeVisible();
    await page.getByRole("button", { name: "Close case" }).click();
    const dlg = page.getByRole("dialog", { name: /Close case/ });
    await dlg.getByRole("combobox", { name: /^Resolution/ }).selectOption("merchant_contacted");
    await dlg.getByLabel("Resolution note").fill("Settlement confirmed by evidence.");
    await dlg.getByRole("button", { name: "Close case" }).click();
    await expect(page.getByText("Closed · Merchant contacted")).toBeVisible();
    expect(api.callsTo("closeOpsCase")[0]?.body).toEqual({
      resolution: "merchant_contacted",
      note: "Settlement confirmed by evidence.",
    });
  });

  test("blocklist: add with step-up, removal is ops_admin only", async ({ page, api }) => {
    api.role = "ops";
    await signIn(page, "/blocklist");
    await expect(page.getByRole("button", { name: /Remove .* from the blocklist/ })).toBeDisabled();
    await expect(page.getByText("Removing entries: Only an ops admin can do this.")).toBeVisible();
    api.stepUpUntil = 0;
    await page.getByRole("button", { name: "Block an address" }).click();
    const dlg = page.getByRole("dialog", { name: "Block an address" });
    await dlg.getByRole("textbox", { name: /^Address/ }).fill("0x00000000000000000000000000000000000000aa");
    await dlg.getByLabel(/Reason/).fill("Phishing kit");
    await dlg.getByRole("button", { name: "Block address" }).click();
    await confirmStepUp(page);
    await expect(page.getByText("0x00000000000000000000000000000000000000aa")).toBeVisible();
    // screening lookup sees the new entry
    await page
      .getByRole("region", { name: "Screen an address" })
      .getByLabel("Address")
      .fill("0x00000000000000000000000000000000000000aa");
    await page.getByRole("button", { name: "Screen now" }).click();
    await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
  });

  test("blocklist: an ops admin removes an entry", async ({ page, api }) => {
    await signIn(page, "/blocklist");
    await page.getByRole("button", { name: /Remove .* from the blocklist/ }).click();
    const dlg = page.getByRole("dialog", { name: "Remove from the blocklist" });
    await dlg.getByLabel(/Reason/).fill("Entry was a typo");
    await dlg.getByRole("button", { name: "Remove entry" }).click();
    await expect(page.getByText("The blocklist is empty.")).toBeVisible();
    expect(api.blocklist).toHaveLength(0);
  });
});
