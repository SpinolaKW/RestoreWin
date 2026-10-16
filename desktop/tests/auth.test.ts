import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../src/main/auth";

const adminPassword = "Principal#Senha2026";
const operatorPassword = "Operador#Senha2026";
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "restorewin-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 1_800_000_000_000;
  const auth = new AuthService(directory, () => now);
  return {
    auth,
    directory,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("first enrollment is serialized and the administrator survives a process restart without an unlocked session", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.auth.state()).initialized, false);
  await assert.rejects(f.auth.require(), { code: "AUTH_REQUIRED" });
  const results = await Promise.allSettled([
    f.auth.setup("diretor", adminPassword),
    f.auth.setup("intruso", operatorPassword),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const fresh = new AuthService(f.directory);
  assert.deepEqual(await fresh.state(), {
    mode: "desktop",
    initialized: true,
    user: null,
  });
  assert.equal(
    (await fresh.login("DIRETOR", adminPassword)).user?.role,
    "admin",
  );
  await assert.rejects(fresh.setup("outro", operatorPassword), {
    code: "ALREADY_INITIALIZED",
  });
});
test("passwords are salted, absent from files and never returned in public user data", async (t) => {
  const { auth } = await fixture(t);
  await auth.setup("diretor", adminPassword);
  const users = await auth.createUser("monitor", adminPassword);
  assert.equal(users[1].role, "operator");
  assert.deepEqual(Object.keys(users[0]).sort(), ["id", "role", "username"]);
  const raw = await readFile(auth.filename, "utf8");
  assert.equal(raw.includes(adminPassword), false);
  const db = JSON.parse(raw);
  assert.notEqual(db.users[0].salt, db.users[1].salt);
  assert.notEqual(db.users[0].hash, db.users[1].hash);
});
test("operators cannot list, create, reset or delete accounts", async (t) => {
  const { auth } = await fixture(t);
  await auth.setup("diretor", adminPassword);
  const users = await auth.createUser("monitor", operatorPassword);
  auth.lock();
  await auth.login("monitor", operatorPassword);
  await assert.rejects(auth.users(), { code: "ADMIN_REQUIRED" });
  await assert.rejects(auth.createUser("outro", operatorPassword), {
    code: "ADMIN_REQUIRED",
  });
  await assert.rejects(auth.changePassword(users[0].id, operatorPassword, ""), {
    code: "ADMIN_REQUIRED",
  });
  await assert.rejects(auth.deleteUser(users[0].id), {
    code: "ADMIN_REQUIRED",
  });
  assert.equal((await auth.require()).role, "operator");
});
test("the first administrator cannot be deleted and password changes require the current password", async (t) => {
  const { auth } = await fixture(t);
  const state = await auth.setup("diretor", adminPassword),
    id = state.user!.id;
  await assert.rejects(auth.deleteUser(id), {
    code: "PRIMARY_ADMIN_PROTECTED",
  });
  await assert.rejects(auth.changePassword(id, operatorPassword, "errada"), {
    code: "INVALID_CREDENTIALS",
  });
  const changed = await auth.changePassword(
    id,
    operatorPassword,
    adminPassword,
  );
  assert.equal(changed.user, null);
  await assert.rejects(auth.login("diretor", adminPassword), {
    code: "INVALID_CREDENTIALS",
  });
  const login = await auth.login("diretor", operatorPassword);
  assert.equal(login.user?.id, id);
  assert.equal(login.user?.username, "diretor");
});
test("administrator can reset and delete an operator without changing its username", async (t) => {
  const { auth } = await fixture(t);
  await auth.setup("diretor", adminPassword);
  const users = await auth.createUser("monitor", operatorPassword),
    id = users[1].id;
  await auth.changePassword(id, "Monitor#NovaSenha2026", "");
  assert.equal((await auth.users())[1].username, "monitor");
  auth.lock();
  await assert.rejects(auth.login("monitor", operatorPassword), {
    code: "INVALID_CREDENTIALS",
  });
  await auth.login("monitor", "Monitor#NovaSenha2026");
  auth.lock();
  await auth.login("diretor", adminPassword);
  assert.equal((await auth.deleteUser(id)).length, 1);
  auth.lock();
  await assert.rejects(auth.login("monitor", "Monitor#NovaSenha2026"), {
    code: "INVALID_CREDENTIALS",
  });
});
test("invalid passwords and duplicate names are rejected without modifying existing accounts", async (t) => {
  const { auth } = await fixture(t);
  await assert.rejects(auth.setup("diretor", "curta"), {
    code: "INVALID_CREDENTIALS_FORMAT",
  });
  await auth.setup("diretor", adminPassword);
  const before = await readFile(auth.filename, "utf8");
  await assert.rejects(auth.createUser("DIRETOR", operatorPassword), {
    code: "DUPLICATE_USER",
  });
  await assert.rejects(auth.createUser("outro", "curta"), {
    code: "INVALID_CREDENTIALS_FORMAT",
  });
  assert.equal(await readFile(auth.filename, "utf8"), before);
});
test("login throttling is persisted and shared by known and unknown usernames", async (t) => {
  const f = await fixture(t);
  await f.auth.setup("diretor", adminPassword);
  f.auth.lock();
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      f.auth.login(i % 2 ? "diretor" : "inexistente", "errada"),
      { code: "INVALID_CREDENTIALS" },
    );
  const fresh = new AuthService(f.directory, () => 1_800_000_000_000);
  await assert.rejects(fresh.login("diretor", adminPassword), {
    code: "AUTH_THROTTLED",
  });
  f.advance(60_001);
  assert.equal(
    (await f.auth.login("diretor", adminPassword)).user?.role,
    "admin",
  );
});
test("expired and explicitly locked sessions cannot perform account mutations", async (t) => {
  const f = await fixture(t);
  await f.auth.setup("diretor", adminPassword);
  f.advance(15 * 60 * 1000);
  assert.equal((await f.auth.state()).user, null);
  await assert.rejects(f.auth.createUser("monitor", operatorPassword), {
    code: "AUTH_REQUIRED",
  });
  await f.auth.login("diretor", adminPassword);
  const pending = f.auth.createUser("monitor", operatorPassword);
  f.auth.lock();
  await assert.rejects(pending, { code: "AUTH_REQUIRED" });
});
test("lock during an asynchronous login cannot leave a hidden window authenticated", async (t) => {
  const { auth } = await fixture(t);
  await auth.setup("diretor", adminPassword);
  auth.lock();
  const pending = auth.login("diretor", adminPassword);
  auth.lock();
  assert.equal((await pending).user, null);
  await assert.rejects(auth.require(), { code: "AUTH_REQUIRED" });
});
test("damaged or deleted account storage fails closed and does not reopen first enrollment", async (t) => {
  const f = await fixture(t);
  await f.auth.setup("diretor", adminPassword);
  await writeFile(f.auth.filename, "{invalid");
  await assert.rejects(f.auth.state(), { code: "ACCOUNTS_DAMAGED" });
  assert.equal(await readFile(f.auth.filename, "utf8"), "{invalid");
  await unlink(f.auth.filename);
  const fresh = new AuthService(f.directory);
  await assert.rejects(fresh.setup("intruso", operatorPassword), {
    code: "ACCOUNTS_DAMAGED",
  });
});
