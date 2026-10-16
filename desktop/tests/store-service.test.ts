import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
  symlink,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SettingsStore } from "../src/main/store";
import { RestoreService } from "../src/main/service";
import type { Computer, Profile } from "../src/shared/contracts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "restorewin-desktop-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "settings");
  const data = path.join(root, "Documents");
  await mkdir(data);
  const store = new SettingsStore(directory);
  const computer: Computer = {
    platform: process.platform === "win32" ? "windows" : "linux",
    osName: "Test system",
    osVersion: "test",
    architecture: "x64",
    installationDirectory: root,
    diagnosticWarnings: [],
    volumes: [
      {
        id: "system",
        label: "System",
        mountPoint: root,
        source: "test",
        filesystem: "test",
        totalBytes: 100,
        freeBytes: 50,
        system: true,
        readOnly: false,
      },
    ],
  };
  const service = new RestoreService(store, async () => computer, "0.1.0");
  const profile: Profile = {
    baselineName: "Base de teste",
    protectedVolumeIds: ["system"],
    exclusions: [{ id: randomUUID(), path: data }],
  };
  return { root, directory, data, store, service, profile };
}

test("settings persist across a fresh service instance and keep previous backups", async (t) => {
  const f = await fixture(t);
  const first = await f.service.saveProfile(f.profile, 0);
  assert.equal(first.settings.revision, 1);
  assert.equal(first.protection.phase, "unavailable");
  const freshStore = new SettingsStore(f.directory);
  assert.deepEqual((await freshStore.load()).profile, f.profile);
  await f.service.saveProfile({ ...f.profile, baselineName: "Atualizada" }, 1);
  const backup = (await readdir(f.directory)).find((name) =>
    name.includes(".backup.json"),
  );
  assert.ok(backup);
  assert.equal(
    JSON.parse(await readFile(path.join(f.directory, backup), "utf8")).profile
      .baselineName,
    "Base de teste",
  );
});
test("freeze and thaw fail explicitly without changing configuration or writing a fake state", async (t) => {
  const f = await fixture(t);
  await f.service.saveProfile(f.profile, 0);
  const before = await readFile(f.store.filename, "utf8");
  for (const action of ["freeze", "thaw"])
    await assert.rejects(f.service.requestProtection(action), {
      code: "BACKEND_UNAVAILABLE",
    });
  await assert.rejects(f.service.requestProtection("reboot"), {
    code: "INVALID_ACTION",
  });
  assert.equal(await readFile(f.store.filename, "utf8"), before);
  assert.equal((await f.service.snapshot()).protection.confirmedBaseline, null);
});
test("concurrent stale saves cannot overwrite the first saved revision", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    f.store.save(f.profile, 0),
    f.store.save({ ...f.profile, baselineName: "Lost update" }, 0),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(
    (await f.store.load()).profile.baselineName,
    f.profile.baselineName,
  );
});
test("damaged existing configuration is retained and blocks a save", async (t) => {
  const f = await fixture(t);
  await mkdir(f.directory);
  const corrupt = "{not-valid-json";
  await writeFile(f.store.filename, corrupt);
  await assert.rejects(f.store.load(), { code: "SETTINGS_DAMAGED" });
  await assert.rejects(f.store.save(f.profile, 0), {
    code: "SETTINGS_DAMAGED",
  });
  assert.equal(await readFile(f.store.filename, "utf8"), corrupt);
});
test("missing folders and symlinks are rejected without creating settings", async (t) => {
  const f = await fixture(t);
  const p = structuredClone(f.profile);
  p.exclusions[0].path = path.join(f.root, "missing");
  await assert.rejects(f.service.saveProfile(p, 0), { code: "FOLDER_MISSING" });
  const link = path.join(f.root, "linked");
  await symlink(
    f.data,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  p.exclusions[0].path = link;
  await assert.rejects(f.service.saveProfile(p, 0), { code: "FOLDER_LINK" });
  assert.equal((await f.store.load()).revision, 0);
});
test("an invalid revision is rejected before persistence", async (t) => {
  const f = await fixture(t);
  for (const revision of [-1, 1.2, "0", null])
    await assert.rejects(f.service.saveProfile(f.profile, revision), {
      code: "INVALID_REVISION",
    });
});
