import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateProfile, unavailableProtection } from "../src/main/domain";
import type { Profile, Volume } from "../src/shared/contracts";
import { parseMountInfo } from "../src/main/platform";

const volume = (
  id: string,
  mountPoint: string,
  more: Partial<Volume> = {},
): Volume => ({
  id,
  mountPoint,
  label: id,
  source: id,
  filesystem: "test",
  totalBytes: 100,
  freeBytes: 50,
  system: true,
  readOnly: false,
  ...more,
});
function profile(path?: string): Profile {
  return {
    baselineName: "Base",
    protectedVolumeIds: ["system"],
    exclusions: path ? [{ id: randomUUID(), path }] : [],
  };
}
const win = [volume("system", "C:\\")],
  linux = [volume("system", "/")];

test("Windows data folders are case insensitive and use drive-aware ancestry", () => {
  assert.equal(
    validateProfile(profile("c:\\Users\\Ana\\Documents"), win, "windows")
      .exclusions.length,
    1,
  );
  assert.throws(
    () => validateProfile(profile("D:\\Users\\Ana"), win, "windows"),
    /unidades selecionadas/,
  );
});
test("Windows system folders and traversal cannot become permanent exclusions", () => {
  for (const path of [
    "C:\\",
    "C:\\Windows",
    "c:\\WINDOWS\\System32",
    "C:\\Users\\..\\Windows",
    "C:\\Program Files\\App",
    "C:\\ProgramData",
  ])
    assert.throws(
      () => validateProfile(profile(path), win, "windows"),
      /pasta de dados/,
    );
});
test("UNC paths, devices, relative paths and alternate streams are rejected", () => {
  for (const path of [
    "\\\\server\\share",
    "\\\\.\\PhysicalDrive0",
    "Documents",
    "C:\\Users\\Ana:stream",
  ])
    assert.throws(
      () => validateProfile(profile(path), win, "windows"),
      /caminho absoluto/,
    );
});
test("Linux data folders are allowed, system trees and ancestors are not", () => {
  assert.equal(
    validateProfile(profile("/home/ana/Documentos"), linux, "linux").exclusions
      .length,
    1,
  );
  for (const path of ["/", "/etc", "/usr/local", "/home/../boot", "/var"])
    assert.throws(
      () => validateProfile(profile(path), linux, "linux"),
      /pasta de dados/,
    );
});
test("a nested unselected mount is not part of its protected parent", () => {
  const volumes = [...linux, volume("data", "/mnt/dados")];
  assert.throws(
    () => validateProfile(profile("/mnt/dados/docs"), volumes, "linux"),
    /unidades selecionadas/,
  );
  const p = profile("/mnt/dados/docs");
  p.protectedVolumeIds.push("data");
  assert.equal(validateProfile(p, volumes, "linux").exclusions.length, 1);
});
test("duplicates and overlapping paths are rejected", () => {
  const p = profile("C:\\Users\\Ana\\Documents");
  p.exclusions.push({ id: randomUUID(), path: "c:\\users\\ana\\documents" });
  assert.throws(() => validateProfile(p, win, "windows"), /já está/);
  p.exclusions[1].path = "C:\\Users\\Ana\\Documents\\Work";
  assert.throws(() => validateProfile(p, win, "windows"), /coberta/);
});
test("offline, read-only and duplicated volumes are rejected", () => {
  assert.throws(
    () => validateProfile(profile(), [], "linux"),
    /não está disponível/,
  );
  assert.throws(
    () =>
      validateProfile(
        profile(),
        [volume("system", "/", { readOnly: true })],
        "linux",
      ),
    /somente leitura/,
  );
  const p = profile();
  p.protectedVolumeIds.push("system");
  assert.throws(() => validateProfile(p, linux, "linux"), /mais de uma vez/);
  assert.throws(
    () => validateProfile(profile(), [volume("system", "/", { readOnly: null })], "linux"),
    { code: "VOLUME_ACCESS_UNKNOWN" },
  );
});
test("renderer input cannot inject an active protection state", () => {
  assert.throws(
    () => validateProfile({ ...profile(), frozen: true }, linux, "linux"),
    /Configuração inválida/,
  );
  assert.throws(
    () => validateProfile({ ...profile(), baselineName: "  " }, linux, "linux"),
    /Configuração inválida/,
  );
});
test("all unavailable platforms refuse activation and have no confirmed baseline", () => {
  for (const platform of ["windows", "linux", "unsupported"] as const) {
    const state = unavailableProtection(platform);
    assert.equal(state.phase, "unavailable");
    assert.equal(state.canFreeze, false);
    assert.equal(state.canThaw, false);
    assert.equal(state.confirmedBaseline, null);
  }
});
test("mountinfo decoding excludes pseudo filesystems and preserves directory/subvolume candidates", () => {
  const raw = [
    "1 0 0:1 / / rw - overlay overlay rw",
    "2 1 0:2 / /proc rw - proc proc rw",
    "3 1 8:1 /file /etc/hosts rw - ext4 /dev/sda1 rw",
    "4 1 8:2 / /mnt/My\\040Data rw - ext4 /dev/sdb1 rw",
    "5 1 8:3 / /mnt/readonly ro - ext4 /dev/sdc1 ro",
  ].join("\n");
  const result = parseMountInfo(raw);
  assert.deepEqual(
    result.map((v) => v.target),
    ["/", "/etc/hosts", "/mnt/My Data", "/mnt/readonly"],
  );
  assert.equal(result[3].readOnly, true);
});
