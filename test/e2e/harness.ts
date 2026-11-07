/**
 * Shared E2E setup: the in-process spec-validating mock API, a CDP WebAuthn virtual authenticator
 * that plays a roaming hardware security key (USB, CTAP2), and the guard that fails every test on a
 * page error or a CSP violation.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { MockApi } from "./mock-api";

async function securityKey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  // an enrolled discoverable credential for localhost, so sign-in works without enrolling first
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" });
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: randomBytes(16).toString("base64"),
      isResidentCredential: true,
      rpId: "localhost",
      privateKey: Buffer.from(key).toString("base64"),
      userHandle: randomBytes(16).toString("base64"),
      signCount: 1,
    },
  });
}

export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text());
    });
    // CSP violations are also reported as DOM events (covers violations without a console line)
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        console.error(`Refused to load: CSP violation of ${e.violatedDirective} (${e.blockedURI})`);
      });
    });
    await api.install(page);
    await securityKey(page);
    await use(api);
    expect(api.unexpected, "routes the mock does not implement").toEqual([]);
    expect(errors, "page errors / CSP violations").toEqual([]);
  },
});

/** Signs in with the virtual security key through the UI. */
export async function signIn(page: Page, path = "/") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/signin/);
  await page.getByRole("button", { name: "Sign in with security key" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

/** Completes the step-up dialog with the virtual key. */
export async function confirmStepUp(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Confirm with your security key" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm with security key" }).click();
  await expect(dialog).toBeHidden();
}

export { expect };
