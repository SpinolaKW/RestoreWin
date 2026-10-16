import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

let app: ElectronApplication;
let page: Page;
let directory: string;
let documents: string;
const pageErrors: string[] = [];
const adminPassword = "Principal#Senha2026";

async function signIn() {
  const state = await page.evaluate(() => window.restorewin!.authState());
  expect(state.ok).toBe(true);
  if (!state.ok || state.value.user) return;
  await page.getByLabel("Usuário", { exact: true }).fill("diretor");
  await page.getByLabel("Senha", { exact: true }).fill(adminPassword);
  if (!state.value.initialized) {
    await page.screenshot({
      path: "../artifacts/restorewin-primeiro-acesso.png",
      fullPage: true,
    });
    await expect(
      page.getByText("Não esqueça a senha.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Confirmar senha", { exact: true })
      .fill(adminPassword);
    await page
      .getByLabel("Entendi e vou guardar a senha em local seguro.")
      .check();
    await page
      .getByRole("button", { name: "Criar administrador", exact: true })
      .click();
  } else
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

async function launch() {
  app = await electron.launch({
    args: [process.cwd()],
    env: {
      ...process.env,
      RESTOREWIN_STATE_DIR: path.join(directory, "state"),
    },
  });
  page = await app.firstWindow();
  // Hosted runners may report their unattended OS session as idle. This test
  // drives app input through CDP; test screen-lock signals explicitly instead.
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.getSystemIdleTime = () => 0;
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(
    page.getByRole("heading", {
      name: /Criar administrador principal|Entrar no RestoreWin/,
    }),
  ).toBeVisible();
  const denied = await page.evaluate(() => window.restorewin!.snapshot());
  expect(denied.ok).toBe(false);
  if (!denied.ok) expect(denied.code).toBe("AUTH_REQUIRED");
  await signIn();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("O computador ainda não está protegido pelo RestoreWin.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 20_000 }); // Windows volume inspection has a 15s timeout.
}

test.beforeEach(async () => {
  await mkdir(path.join(process.cwd(), "../artifacts"), { recursive: true });
  await mkdir(path.join(process.cwd(), "test-results"), { recursive: true });
  directory = await mkdtemp(
    path.join(process.cwd(), "test-results", "restorewin-electron-"),
  );
  documents = path.join(directory, "Meus documentos");
  await mkdir(documents);
  pageErrors.length = 0;
  await launch();
});
test.afterEach(async () => {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
  expect(pageErrors).toEqual([]);
});

test("native diagnostics, persisted profile, exclusions, restart and maintenance guard", async () => {
  expect(await page.evaluate(() => typeof window.restorewin?.snapshot)).toBe(
    "function",
  );
  await expect(
    page.getByText("Prévia da interface.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ativar congelamento", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Nome da próxima base").fill("Base para manutenção");
  await page
    .getByRole("button", { name: "Discos e instalação", exact: true })
    .click();
  await page.locator('input[type="checkbox"]:enabled').first().check();
  await page
    .getByRole("button", { name: "Como escolher", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Escolher o local de instalação" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Entendi", exact: true }).click();
  await page
    .getByRole("button", { name: "Pastas permanentes", exact: true })
    .click();
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [selected],
    })) as typeof dialog.showOpenDialog;
  }, documents);
  await page
    .getByRole("button", { name: "Adicionar pasta", exact: true })
    .click();
  await expect(page.getByText(documents, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "O estado da proteção não foi alterado.",
  );
  const saved = JSON.parse(
    await readFile(path.join(directory, "state/settings.json"), "utf8"),
  );
  expect(saved.profile.baselineName).toBe("Base para manutenção");
  expect(saved.profile.exclusions[0].path).toBe(documents);
  expect(saved.profile).not.toHaveProperty("frozen");
  await app.close();
  await launch();
  await expect(page.getByLabel("Nome da próxima base")).toHaveValue(
    "Base para manutenção",
  );
  await page
    .getByRole("button", { name: "Pastas permanentes", exact: true })
    .click();
  await expect(page.getByText(documents, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manutenção", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Descongelar para manutenção",
      exact: true,
    }),
  ).toBeDisabled();
  const result = await page.evaluate(() =>
    window.restorewin!.requestProtection("freeze"),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("BACKEND_UNAVAILABLE");
  await page.getByRole("button", { name: "Atividade", exact: true }).click();
  await expect(
    page.getByText("Configuração salva", { exact: true }),
  ).toBeVisible();
});

test("folder removal and unsaved changes can be discarded without changing saved configuration", async () => {
  await page
    .getByRole("button", { name: "Discos e instalação", exact: true })
    .click();
  await page.locator('input[type="checkbox"]:enabled').first().check();
  await page
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await page.getByLabel("Nome da próxima base").fill("Não salvar");
  await page
    .getByRole("button", { name: "Descartar alterações", exact: true })
    .click();
  await expect(page.getByLabel("Nome da próxima base")).toHaveValue(
    "Minha base de trabalho",
  );
  await page
    .getByRole("button", { name: "Pastas permanentes", exact: true })
    .click();
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [selected],
    })) as typeof dialog.showOpenDialog;
  }, documents);
  await page
    .getByRole("button", { name: "Adicionar pasta", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Remover pasta ${documents}`, exact: true })
    .click();
  await expect(
    page.getByText("Nenhuma pasta adicionada", { exact: true }),
  ).toBeVisible();
  const saved = JSON.parse(
    await readFile(path.join(directory, "state/settings.json"), "utf8"),
  );
  expect(saved.profile.exclusions).toEqual([]);
});

test("interface renders without overflow and documents unavailable capabilities", async () => {
  await page.screenshot({
    path: "../artifacts/restorewin-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Sobre e compatibilidade", exact: true })
    .click();
  await expect(
    page.getByText("Interface preparada; congelamento não implementado.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
});

test("an unavailable saved unit can be removed without editing files manually", async () => {
  await app.close();
  await writeFile(
    path.join(directory, "state/settings.json"),
    JSON.stringify({
      version: 1,
      revision: 1,
      activity: [],
      profile: {
        baselineName: "Base offline",
        protectedVolumeIds: ["unit-no-longer-connected"],
        exclusions: [],
      },
    }),
  );
  await launch();
  await page
    .getByRole("button", { name: "Discos e instalação", exact: true })
    .click();
  await expect(
    page.getByText("Uma unidade selecionada está indisponível.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remover seleção", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");
  const saved = JSON.parse(
    await readFile(path.join(directory, "state/settings.json"), "utf8"),
  );
  expect(saved.revision).toBe(2);
  expect(saved.profile.protectedVolumeIds).toEqual([]);
});

test("authentication manages operators and protects the primary administrator through real IPC", async () => {
  await page
    .getByRole("button", { name: "Usuários e acesso", exact: true })
    .click();
  await expect(
    page.getByText("Administrador principal · conta protegida", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "../artifacts/restorewin-usuarios.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Excluir usuário diretor", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Novo usuário", exact: true }).click();
  await page
    .getByLabel("Nome do novo usuário", { exact: true })
    .fill("monitor");
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("Monitor#Senha2026");
  await page
    .getByLabel("Confirmar nova senha", { exact: true })
    .fill("Monitor#Senha2026");
  await page
    .getByRole("button", { name: "Salvar usuário", exact: true })
    .click();
  await expect(page.getByText("monitor", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Alterar senha de monitor", exact: true })
    .click();
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("Monitor#SenhaNova2026");
  await page
    .getByLabel("Confirmar nova senha", { exact: true })
    .fill("Monitor#SenhaNova2026");
  await page
    .getByRole("button", { name: "Salvar usuário", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Usuário atualizado");
  await page
    .getByRole("button", { name: "Bloquear acesso · diretor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Entrar no RestoreWin", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Usuário", { exact: true }).fill("monitor");
  await page.getByLabel("Senha", { exact: true }).fill("Monitor#SenhaNova2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Usuários e acesso", exact: true }),
  ).toHaveCount(0);
  const denied = await page.evaluate(() => window.restorewin!.users());
  expect(denied.ok).toBe(false);
  if (!denied.ok) expect(denied.code).toBe("ADMIN_REQUIRED");
  const quit = await page.evaluate(() => window.restorewin!.quit());
  expect(quit.ok).toBe(false);
  await page
    .getByRole("button", { name: "Bloquear acesso · monitor", exact: true })
    .click();
  await signIn();
  await page
    .getByRole("button", { name: "Usuários e acesso", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Excluir usuário monitor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(page.getByText("monitor", { exact: true })).toHaveCount(0);
  const raw = await readFile(
    path.join(directory, "state/accounts.json"),
    "utf8",
  );
  expect(raw).not.toContain(adminPassword);
  expect(raw).not.toContain("Monitor#SenhaNova2026");
});

test("background close locks access, keeps the process alive and a second shortcut reopens the same window", async () => {
  const runtime = await page.evaluate(() => window.restorewin!.runtime());
  expect(runtime.ok).toBe(true);
  if (runtime.ok) expect(runtime.value.trayAvailable).toBe(true);
  const pid = app.process().pid;
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
  ).toBe(false);
  const denied = await page.evaluate(() => window.restorewin!.snapshot());
  expect(denied.ok).toBe(false);
  const executable = await app.evaluate(() => process.execPath);
  const child = spawn(executable, ["--no-sandbox", process.cwd()], {
    env: {
      ...process.env,
      RESTOREWIN_STATE_DIR: path.join(directory, "state"),
    },
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Second instance exited ${code}`)),
    );
  });
  expect(app.process().pid).toBe(pid);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Entrar no RestoreWin", exact: true }),
  ).toBeVisible();
  await signIn();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
});

test("authentication primary password change requires current password and a fresh login", async () => {
  await page
    .getByRole("button", { name: "Usuários e acesso", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Alterar senha de diretor", exact: true })
    .click();
  await page
    .getByLabel("Senha atual do administrador", { exact: true })
    .fill("senha errada");
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("Principal#NovaSenha2026");
  await page
    .getByLabel("Confirmar nova senha", { exact: true })
    .fill("Principal#NovaSenha2026");
  await page
    .getByRole("button", { name: "Salvar usuário", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Usuário ou senha inválidos",
  );
  await page
    .getByLabel("Senha atual do administrador", { exact: true })
    .fill(adminPassword);
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("Principal#NovaSenha2026");
  await page
    .getByLabel("Confirmar nova senha", { exact: true })
    .fill("Principal#NovaSenha2026");
  await page
    .getByRole("button", { name: "Salvar usuário", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Entrar no RestoreWin", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Usuário", { exact: true }).fill("diretor");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Principal#NovaSenha2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
});

test("authentication locks on operating-system screen lock and suspension signals", async () => {
  for (const event of ["lock-screen", "suspend"] as const) {
    await app.evaluate(
      ({ powerMonitor }, signal) => powerMonitor.emit(signal),
      event,
    );
    await expect(
      page.getByRole("heading", { name: "Entrar no RestoreWin", exact: true }),
    ).toBeVisible();
    const result = await page.evaluate(() => window.restorewin!.snapshot());
    expect(result.ok).toBe(false);
    await signIn();
    await expect(
      page.getByRole("heading", { name: "Visão geral", exact: true }),
    ).toBeVisible();
  }
});
