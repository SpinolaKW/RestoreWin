import type { Bridge, Settings, Snapshot } from "../shared/contracts";
import { ProfileSchema, SettingsSchema } from "../shared/schema";

const key = "restorewin-interface-preview-v1";
function settings(): Settings {
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      return SettingsSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(
        "Os dados da prévia estão inválidos. Nenhuma configuração real do computador foi alterada.",
      );
    }
  }
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
function preview(): Snapshot {
  return {
    mode: "preview",
    appVersion: "0.1.0",
    settings: settings(),
    computer: {
      platform: "linux",
      osName: "Ubuntu / Debian (exemplo)",
      osVersion: "Prévia da interface",
      architecture: "x64",
      installationDirectory: "/opt/restorewin (exemplo)",
      diagnosticWarnings: [],
      volumes: [
        {
          id: "preview-system",
          label: "Sistema",
          mountPoint: "/",
          source: "/dev/nvme0n1p2",
          filesystem: "ext4",
          totalBytes: 512e9,
          freeBytes: 356e9,
          system: true,
          readOnly: false,
        },
        {
          id: "preview-data",
          label: "Dados",
          mountPoint: "/mnt/dados",
          source: "/dev/sda1",
          filesystem: "ext4",
          totalBytes: 1e12,
          freeBytes: 802e9,
          system: false,
          readOnly: false,
        },
      ],
    },
    protection: {
      phase: "unavailable",
      canFreeze: false,
      canThaw: false,
      confirmedBaseline: null,
      reason:
        "O mecanismo de proteção ainda não está implementado. Nesta prévia, apenas a interface e a configuração de exemplo estão disponíveis.",
    },
  };
}
const browser: Bridge = {
  async snapshot() {
    try {
      return { ok: true, value: preview() };
    } catch (error) {
      return {
        ok: false,
        code: "PREVIEW_DATA_INVALID",
        message: (error as Error).message,
      };
    }
  },
  async saveProfile(profile, expectedRevision) {
    try {
      const old = settings();
      if (old.revision !== expectedRevision)
        return {
          ok: false,
          code: "STALE_SETTINGS",
          message: "A prévia mudou em outra aba. Atualize antes de salvar.",
        };
      const checked = ProfileSchema.parse(profile);
      const next: Settings = {
        ...old,
        revision: old.revision + 1,
        profile: checked,
        activity: [
          {
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
            title: "Configuração de exemplo salva",
            detail:
              "Somente os dados desta prévia no navegador foram alterados. Nenhum computador foi congelado.",
            kind: "success" as const,
          },
          ...old.activity,
        ].slice(0, 100),
      };
      localStorage.setItem(key, JSON.stringify(next));
      return { ok: true, value: preview() };
    } catch {
      return {
        ok: false,
        code: "PREVIEW_SAVE_FAILED",
        message: "Não foi possível salvar os dados de exemplo da prévia.",
      };
    }
  },
  async chooseFolder() {
    return { ok: true, value: null };
  },
  async requestProtection() {
    return {
      ok: false,
      code: "BACKEND_UNAVAILABLE",
      message:
        "Nenhuma proteção foi ativada. O mecanismo ainda não está implementado.",
    };
  },
};
export const bridge: Bridge = window.restorewin ?? browser;
