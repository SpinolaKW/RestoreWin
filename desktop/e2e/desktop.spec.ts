import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

let app: ElectronApplication;
let page: Page;
let directory: string;
let documents: string;
const pageErrors: string[] = [];

async function launch() {
  app = await electron.launch({
    args: [process.cwd()],
    env: {
      ...process.env,
      RESTOREWIN_STATE_DIR: path.join(directory, "state"),
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("O computador ainda não está protegido pelo RestoreWin.", {
      exact: true,
    }),
  ).toBeVisible();
}

test.beforeEach(async () => {
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
