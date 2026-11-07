import { expect, signIn, test } from "./harness";

test.describe("auth", () => {
  test("redirects to sign-in, signs in with a security key, keeps nothing in web storage, restores on reload", async ({
    page,
    api,
  }) => {
    await signIn(page, "/merchants");
    await expect(page).toHaveURL(/\/merchants$/);
    await expect(page.getByRole("heading", { name: "Merchants", level: 1 })).toBeVisible();
    const verify = api.callsTo("opsPasskeyAuthenticationVerify")[0]?.body as { credential: { type: string } };
    expect(verify.credential.type).toBe("public-key");
    expect(await page.evaluate(() => [sessionStorage.length, localStorage.length])).toEqual([0, 0]);
    const restores = api.callsTo("getOpsSession").length;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Merchants", level: 1 })).toBeVisible();
    expect(api.callsTo("getOpsSession")).toHaveLength(restores + 1);
    // the shell shows the operator and role; nav works without a full reload
    await expect(page.getByText("Riya · Ops admin")).toBeVisible();
    await page.getByRole("navigation", { name: "Operations" }).getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    expect(api.callsTo("getOpsSession")).toHaveLength(restores + 1);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByText("You are signed out")).toBeVisible();
    expect(api.callsTo("opsLogout")[0]?.headers["x-csrf-token"]).toBe(api.csrf);
  });

  test("a refused sign-in shows the console copy", async ({ page, api }) => {
    api.failNext.opsPasskeyAuthenticationVerify = {
      status: 401,
      type: "authentication_error",
      code: "webauthn_failed",
    };
    await page.goto("/signin");
    await page.getByRole("button", { name: "Sign in with security key" }).click();
    await expect(page.getByRole("alert")).toContainText("not registered for the console");
  });

  test("enrolment link: token leaves the address bar, hardware key registration signs in", async ({ page, api }) => {
    await page.goto("/auth/enrol#token=enrol-token-0123456789abcdef");
    await expect(page.getByRole("heading", { name: "Register your security key" })).toBeVisible();
    expect(page.url()).not.toContain("token");
    await expect(page.getByText("new.operator@nearpay.money")).toBeVisible();
    await page.getByLabel("Key name").fill("YubiKey desk");
    await page.getByRole("button", { name: "Register security key" }).click();
    await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
    const reg = api.callsTo("opsPasskeyRegistrationVerify")[0]?.body as {
      passkey_name: string;
      registration_token: string;
    };
    expect(reg.passkey_name).toBe("YubiKey desk");
    expect(reg.registration_token.length).toBeGreaterThanOrEqual(32);
    // the new operator holds the `ops` role
    await expect(page.getByText("New · Operations")).toBeVisible();
  });

  test("enrolment: a key that is not a hardware key on the allow-list is refused with an explanation", async ({
    page,
    api,
  }) => {
    api.failNext.opsPasskeyRegistrationVerify = {
      status: 403,
      type: "permission_error",
      code: "authenticator_not_allowed",
    };
    await page.goto("/auth/enrol#token=enrol-token-0123456789abcdef");
    await page.getByRole("button", { name: "Register security key" }).click();
    await expect(page.getByRole("alert")).toContainText("not on NearPay’s hardware security key allow-list");
    await expect(page.getByRole("alert")).toContainText("authenticator_not_allowed");
  });

  test("enrolment: used and expired links", async ({ page, api }) => {
    api.enrolTokens.set("used-token-0123456789abcdef", "used");
    await page.goto("/auth/enrol#token=used-token-0123456789abcdef");
    await expect(page.getByText("This link was already used")).toBeVisible();
    await page.goto("/signin");
    await page.goto("/auth/enrol#token=unknown-token-0123456789");
    await expect(page.getByText("The link is expired or incomplete")).toBeVisible();
    await page.getByRole("button", { name: "Go to sign in" }).click();
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("session expiry: warning before the end, local sign-out at the end, back to the page after sign-in", async ({
    page,
    api,
  }) => {
    await page.clock.install();
    api.sessionTtl = 100; // absolute expiry in 100 s → the warning shows at once
    await signIn(page, "/holds");
    const dialog = page.getByRole("dialog", { name: "Your console session is ending" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("at most 12 hours");
    await page.clock.fastForward(110_000);
    await expect(page).toHaveURL(/\/signin\?next=%2Fholds/);
    await expect(page.getByText("Your session ended")).toBeVisible();
    api.sessionTtl = 12 * 3600;
    await page.getByRole("button", { name: "Sign in with security key" }).click();
    await expect(page).toHaveURL(/\/holds$/);
  });

  test("a 401 from any call signs out locally", async ({ page, api }) => {
    await signIn(page, "/merchants");
    await expect(page.getByRole("table", { name: "Merchants" }).getByRole("row")).toHaveCount(4);
    api.signedIn = false;
    await page.getByLabel("Status").selectOption("suspended");
    await expect(page).toHaveURL(/\/signin\?next=%2Fmerchants/);
    await expect(page.getByText("Your session ended")).toBeVisible();
  });
});
