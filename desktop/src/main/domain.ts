import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Activity,
  Platform,
  Profile,
  Protection,
  Settings,
  Volume,
  StorageDiagnostic,
} from "../shared/contracts";
import { ProfileSchema } from "../shared/schema";
export { ProfileSchema, SettingsSchema } from "../shared/schema";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public storage?: StorageDiagnostic,
  ) {
    super(message);
  }
}

export function initialSettings(): Settings {
  return {
    version: 1,
    revision: 0,
    profile: {
      baselineName: "Minha base de trabalho",
      protectedVolumeIds: [],
      exclusions: [],
    },
    activity: [],
  };
}

export function activity(
  title: string,
  detail: string,
  kind: Activity["kind"] = "info",
): Activity {
  return {
    id: randomUUID(),
    time: new Date().toISOString(),
    title,
    detail,
    kind,
  };
}

export function unavailableProtection(platform: Platform): Protection {
  const system =
    platform === "windows"
      ? "Windows"
      : platform === "linux"
        ? "Linux"
        : "este sistema";
  return {
    phase: "unavailable",
    canFreeze: false,
    canThaw: false,
    confirmedBaseline: null,
    reason: `O componente de proteção para ${system} ainda não está implementado nesta versão. Você pode preparar e salvar a configuração; o RestoreWin ainda não congela este computador.`,
  };
}

function key(value: string, platform: Platform): string {
  const api = platform === "windows" ? path.win32 : path.posix;
  const pathValue = api.normalize(value);
  const root = api.parse(pathValue).root;
  const normalized =
    pathValue.length > root.length
      ? pathValue.replace(/[\\/]+$/, "")
      : pathValue;
  return platform === "windows" ? normalized.toLowerCase() : normalized;
}

export function isWithin(
  child: string,
  parent: string,
  platform: Platform,
): boolean {
  const api = platform === "windows" ? path.win32 : path.posix;
  const relative = api.relative(key(parent, platform), key(child, platform));
  return (
    relative === "" ||
    (!relative.startsWith(`..${api.sep}`) &&
      relative !== ".." &&
      !api.isAbsolute(relative))
  );
}

export function validateProfile(
  value: unknown,
  volumes: Volume[],
  platform: Platform,
): Profile {
  const parsed = ProfileSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      "INVALID_PROFILE",
      "Configuração inválida. Confira o nome da base e as pastas selecionadas.",
    );
  const profile = parsed.data;
  if (platform === "unsupported")
    throw new AppError(
      "UNSUPPORTED_PLATFORM",
      "Esta plataforma ainda não tem suporte.",
    );
  if (
    new Set(profile.protectedVolumeIds).size !==
    profile.protectedVolumeIds.length
  )
    throw new AppError(
      "DUPLICATE_VOLUME",
      "Uma unidade foi selecionada mais de uma vez.",
    );
  const selected = profile.protectedVolumeIds.map((id) => {
    const volume = volumes.find((v) => v.id === id);
    if (!volume)
      throw new AppError(
        "VOLUME_MISSING",
        "Uma unidade selecionada não está disponível. Atualize a lista de discos.",
      );
    if (volume.readOnly)
      throw new AppError(
        "READ_ONLY_VOLUME",
        "Uma unidade somente leitura não pode ser selecionada para congelamento.",
      );
    if (volume.readOnly === null)
      throw new AppError(
        "VOLUME_ACCESS_UNKNOWN",
        "Não foi possível confirmar o acesso à unidade. Atualize o diagnóstico antes de selecioná-la.",
      );
    return volume;
  });
  const paths = new Set<string>(),
    ids = new Set<string>();
  const api = platform === "windows" ? path.win32 : path.posix;
  const critical =
    platform === "windows"
      ? selected.flatMap((v) =>
          [
            "Windows",
            "Program Files",
            "Program Files (x86)",
            "ProgramData",
            "$Recycle.Bin",
            "System Volume Information",
          ].map((p) => api.join(v.mountPoint, p)),
        )
      : [
          "/boot",
          "/etc",
          "/usr",
          "/bin",
          "/sbin",
          "/lib",
          "/lib64",
          "/dev",
          "/proc",
          "/sys",
          "/run",
          "/var/lib",
        ];
  for (const folder of profile.exclusions) {
    if (
      !api.isAbsolute(folder.path) ||
      folder.path.includes("\0") ||
      (platform === "windows" &&
        (/^\\\\/.test(folder.path) || /[:]/.test(folder.path.slice(2))))
    )
      throw new AppError(
        "INVALID_FOLDER",
        "Escolha uma pasta local com caminho absoluto.",
      );
    const normalized = key(folder.path, platform);
    if (paths.has(normalized) || ids.has(folder.id))
      throw new AppError("DUPLICATE_FOLDER", "Essa pasta já está na lista.");
    paths.add(normalized);
    ids.add(folder.id);
    // The most specific mounted filesystem owns a path. A nested unprotected
    // mount must not be mistaken for an exclusion on the protected parent.
    const owner = [...volumes]
      .filter((v) => isWithin(folder.path, v.mountPoint, platform))
      .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
    if (!owner || !selected.some((v) => v.id === owner.id))
      throw new AppError(
        "FOLDER_OUTSIDE_SELECTION",
        "A pasta precisa estar em uma das unidades selecionadas.",
      );
    if (
      volumes.some((v) => key(v.mountPoint, platform) === normalized) ||
      critical.some(
        (p) =>
          isWithin(folder.path, p, platform) ||
          isWithin(p, folder.path, platform),
      )
    )
      throw new AppError(
        "SYSTEM_FOLDER",
        "Escolha uma pasta de dados. Raízes de unidades e pastas essenciais do sistema não podem ser excluídas.",
      );
    const overlaps = profile.exclusions.some(
      (other) =>
        other.id !== folder.id &&
        (isWithin(folder.path, other.path, platform) ||
          isWithin(other.path, folder.path, platform)),
    );
    if (overlaps)
      throw new AppError(
        "OVERLAPPING_FOLDER",
        "Uma pasta já está coberta por outra exclusão.",
      );
  }
  return profile;
}
