// Run only on a fresh, disposable GitHub Windows runner. Exercise the real
// packaged data directory rather than the development state override.
import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true")
  throw new Error(
    "This smoke check requires a disposable GitHub Windows runner.",
  );
const env = { ...process.env };
delete env.RESTOREWIN_STATE_DIR;
let app;
try {
  app = await electron.launch({
    executablePath: path.join(
      process.cwd(),
      "release/win-unpacked/RestoreWin.exe",
    ),
    args: [],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => typeof window.restorewin?.authState === "function",
  );
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  const initial = await page.evaluate(() => window.restorewin.authState());
  if (!initial.ok)
    throw new Error(
      JSON.stringify({
        code: initial.code,
        storage: initial.storage,
        userData,
      }),
    );
  if (initial.value.initialized)
    throw new Error(
      "Runner profile already initialized; no accounts were changed.",
    );
  await expect(
    page.getByRole("heading", {
      name: "Criar administrador principal",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Usuário", { exact: true }).fill("ciadmin");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Only#DisposableRunner2026");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Only#DisposableRunner2026");
  await page
    .getByLabel("Entendi e vou guardar a senha em local seguro.")
    .check();
  await page
    .getByRole("button", { name: "Criar administrador", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const runtime = await page.evaluate(() => window.restorewin.runtime());
  if (
    !runtime.ok ||
    !runtime.value.trayAvailable ||
    !runtime.value.autoStartSupported
  )
    throw new Error("Packaged Windows runtime/tray unavailable");
  const state = await page.evaluate(() => window.restorewin.snapshot());
  if (!state.ok || state.value.protection.phase !== "unavailable")
    throw new Error("Unexpected protection state");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  const after = await page.evaluate(() => window.restorewin.snapshot());
  if (after.ok || after.code !== "AUTH_REQUIRED")
    throw new Error("Packaged close did not lock access");
  console.log(
    JSON.stringify({
      packagedWindowsStarted: true,
      userData,
      firstEnrollment: true,
      trayAvailable: true,
      closeLocksAccess: true,
      bootProtectionTested: false,
    }),
  );
} catch (error) {
  const message = String(error.message)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.error("::error title=Pacote Windows::" + message);
  throw error;
} finally {
  await app?.close();
}
