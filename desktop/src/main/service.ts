import { lstat, realpath } from "node:fs/promises";
import type { Computer, Profile, Snapshot } from "../shared/contracts";
import { AppError, unavailableProtection, validateProfile } from "./domain";
import { SettingsStore } from "./store";

export class RestoreService {
  constructor(
    private store: SettingsStore,
    private inspect: () => Promise<Computer>,
    private version: string,
  ) {}

  async snapshot(): Promise<Snapshot> {
    const [computer, settings] = await Promise.all([
      this.inspect(),
      this.store.load(),
    ]);
    return {
      mode: "desktop",
      appVersion: this.version,
      computer,
      settings,
      protection: unavailableProtection(computer.platform),
    };
  }

  async saveProfile(
    value: unknown,
    expectedRevision: unknown,
  ): Promise<Snapshot> {
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0)
      throw new AppError(
        "INVALID_REVISION",
        "Revisão da configuração inválida.",
      );
    const computer = await this.inspect();
    const profile = validateProfile(value, computer.volumes, computer.platform);
    for (const folder of profile.exclusions) {
      let info, canonical;
      try {
        info = await lstat(folder.path);
        canonical = await realpath(folder.path);
      } catch {
        throw new AppError(
          "FOLDER_MISSING",
          "Uma pasta selecionada não está acessível. Confira se a unidade está conectada.",
        );
      }
      const equal =
        computer.platform === "windows"
          ? canonical.toLowerCase() ===
            folder.path.replace(/[\\/]+$/, "").toLowerCase()
          : canonical === folder.path.replace(/\/+$/, "");
      if (!info.isDirectory() || info.isSymbolicLink() || !equal)
        throw new AppError(
          "FOLDER_LINK",
          "Selecione uma pasta de dados real. Atalhos e links precisam ser substituídos pela pasta de destino.",
        );
    }
    await this.store.save(profile as Profile, Number(expectedRevision));
    return this.snapshot();
  }

  async requestProtection(action: unknown): Promise<Snapshot> {
    if (action !== "freeze" && action !== "thaw")
      throw new AppError("INVALID_ACTION", "Operação inválida.");
    // There is deliberately no UI-only state toggle, disk operation, shell
    // command, privileged helper or prototype C engine attached to this action.
    throw new AppError(
      "BACKEND_UNAVAILABLE",
      "O mecanismo de proteção ainda não está implementado. Nenhuma alteração de congelamento ou manutenção foi aplicada.",
    );
  }
}
