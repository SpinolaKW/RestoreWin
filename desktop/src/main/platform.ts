import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, statfs } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Computer, Platform, Volume } from "../shared/contracts";

const execute = promisify(execFile);
export function platformName(platform = process.platform): Platform {
  return platform === "win32"
    ? "windows"
    : platform === "linux"
      ? "linux"
      : "unsupported";
}

export function parseMountInfo(raw: string): Array<{
  id: string;
  source: string;
  target: string;
  filesystem: string;
  readOnly: boolean;
}> {
  const decode = (s: string) =>
    s.replace(/\\([0-7]{3})/g, (_, n: string) =>
      String.fromCharCode(parseInt(n, 8)),
    );
  const result = [];
  for (const line of raw.trim().split("\n")) {
    const split = line.indexOf(" - ");
    if (split < 0) continue;
    const left = line.slice(0, split).split(" "),
      right = line.slice(split + 3).split(" ");
    if (left.length < 6 || right.length < 3) continue;
    const target = decode(left[4]),
      source = decode(right[1]),
      filesystem = right[0];
    if (
      !target.startsWith("/") ||
      (target !== "/" &&
        !source.startsWith("/dev/") &&
        filesystem !== "overlay")
    )
      continue;
    if (
      [
        "proc",
        "sysfs",
        "tmpfs",
        "devtmpfs",
        "devpts",
        "cgroup2",
        "squashfs",
        "efivarfs",
      ].includes(filesystem)
    )
      continue;
    const id = createHash("sha256")
      .update(`${source}\0${target}\0${filesystem}`)
      .digest("hex");
    result.push({
      id: `linux:${id}`,
      source,
      target,
      filesystem,
      readOnly: left[5].split(",").includes("ro"),
    });
  }
  return [...new Map(result.map((v) => [v.target, v])).values()];
}

async function linuxVolumes(): Promise<Volume[]> {
  const rows = parseMountInfo(await readFile("/proc/self/mountinfo", "utf8"));
  const result = await Promise.all(
    rows.map(async (row) => {
      try {
        if (!(await stat(row.target)).isDirectory()) return null;
        const stats = await statfs(row.target);
        return {
          id: row.id,
          label:
            row.target === "/"
              ? "Sistema Linux"
              : path.posix.basename(row.target),
          mountPoint: row.target,
          source: row.source,
          filesystem: row.filesystem,
          totalBytes: stats.blocks * stats.bsize,
          freeBytes: stats.bavail * stats.bsize,
          system: row.target === "/",
          readOnly: row.readOnly,
        } satisfies Volume;
      } catch {
        return null;
      }
    }),
  );
  return result.filter((v) => v !== null);
}

const windowsQuery = String.raw`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
$volumes = @(Get-CimInstance Win32_Volume -ErrorAction Stop | Where-Object { $_.DriveType -eq 3 -and $_.DriveLetter } | ForEach-Object {
  $volume = $_
  $readOnly = $null
  try {
    $partition = Get-Partition -DriveLetter $volume.DriveLetter.TrimEnd(':') -ErrorAction Stop
    $disk = $partition | Get-Disk -ErrorAction Stop
    if ($null -eq $partition -or $null -eq $disk) { throw 'Volume access unknown' }
    $readOnly = [bool](($partition.IsReadOnly -contains $true) -or ($disk.IsReadOnly -contains $true))
  } catch { $readOnly = $null }
  [ordered]@{id=$volume.DeviceID;letter=$volume.DriveLetter;label=$volume.Label;filesystem=$volume.FileSystem;capacity=$volume.Capacity;free=$volume.FreeSpace;system=($volume.DriveLetter -eq $env:SystemDrive);readOnly=$readOnly}
})
[ordered]@{edition=$cv.EditionID;displayVersion=$cv.DisplayVersion;build=$cv.CurrentBuildNumber;revision=$cv.UBR;volumes=$volumes} | ConvertTo-Json -Depth 5 -Compress`;

export async function inspectComputer(
  installationDirectory: string,
): Promise<Computer> {
  const platform = platformName();
  const computer: Computer = {
    platform,
    osName:
      platform === "windows"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : os.type(),
    osVersion: os.release(),
    architecture: os.arch(),
    installationDirectory,
    volumes: [],
    diagnosticWarnings: [],
  };
  try {
    if (platform === "linux") {
      const release = await readFile("/etc/os-release", "utf8").catch(() => "");
      computer.osName =
        /^PRETTY_NAME="?(.*?)"?$/m.exec(release)?.[1] || "Linux";
      computer.volumes = await linuxVolumes();
      if (computer.volumes.some((v) => v.filesystem === "overlay"))
        computer.diagnosticWarnings.push(
          "Ambiente Linux em contêiner: os discos físicos do computador não são expostos por esta sessão.",
        );
    } else if (platform === "windows") {
      const encoded = Buffer.from(windowsQuery, "utf16le").toString("base64");
      const result = await execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
      const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
      computer.osName = `Windows ${parsed.edition || ""}`.trim();
      computer.osVersion = `${parsed.displayVersion || ""} · build ${parsed.build}.${parsed.revision}`;
      computer.volumes = (
        Array.isArray(parsed.volumes) ? parsed.volumes : []
      ).map((v: Record<string, unknown>) => ({
        id: String(v.id),
        label: String(
          v.label || (v.system ? "Sistema Windows" : "Disco local"),
        ),
        mountPoint: `${v.letter}\\`,
        source: String(v.letter),
        filesystem: String(v.filesystem || "Desconhecido"),
        totalBytes: Number(v.capacity) || 0,
        freeBytes: Number(v.free) || 0,
        system: Boolean(v.system),
        readOnly: typeof v.readOnly === "boolean" ? v.readOnly : null,
      }));
    }
  } catch {
    computer.diagnosticWarnings.push(
      "Não foi possível consultar todas as unidades. Atualize o diagnóstico ou verifique as permissões do sistema.",
    );
  }
  return computer;
}
