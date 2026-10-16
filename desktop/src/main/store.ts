import { constants } from "node:fs";
import {
  mkdir,
  readFile,
  open,
  rename,
  unlink,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Profile, Settings } from "../shared/contracts";
import { AppError, SettingsSchema, activity, initialSettings } from "./domain";

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  get filename() {
    return path.join(this.directory, "settings.json");
  }

  async load(): Promise<Settings> {
    let raw: string;
    try {
      raw = await readFile(this.filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return initialSettings();
      throw new AppError(
        "SETTINGS_READ_FAILED",
        "Não foi possível ler a configuração. O arquivo existente foi preservado.",
      );
    }
    try {
      if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("Too large");
      return SettingsSchema.parse(JSON.parse(raw));
    } catch {
      throw new AppError(
        "SETTINGS_DAMAGED",
        "A configuração está inválida. O arquivo foi preservado; restaure uma cópia antes de salvar novamente.",
      );
    }
  }

  save(profile: Profile, expectedRevision: number): Promise<Settings> {
    const operation = this.queue.then(() =>
      this.saveSerial(profile, expectedRevision),
    );
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async saveSerial(
    profile: Profile,
    expectedRevision: number,
  ): Promise<Settings> {
    const previous = await this.load();
    if (previous.revision !== expectedRevision)
      throw new AppError(
        "STALE_SETTINGS",
        "A configuração mudou em outra janela. Atualize os dados antes de salvar.",
      );
    const next: Settings = SettingsSchema.parse({
      ...previous,
      revision: previous.revision + 1,
      profile,
      activity: [
        activity(
          "Configuração salva",
          `${profile.protectedVolumeIds.length} unidade(s) e ${profile.exclusions.length} pasta(s) selecionadas. A proteção não foi ativada.`,
          "success",
        ),
        ...previous.activity,
      ].slice(0, 100),
    });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `settings.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Each backup has a unique name; no prior user backup is overwritten.
      try {
        await copyFile(
          this.filename,
          path.join(
            this.directory,
            `settings.r${previous.revision}.${randomUUID()}.backup.json`,
          ),
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(temporary, this.filename);
      return next;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "SETTINGS_SAVE_FAILED",
        "Não foi possível salvar a configuração. Confira o espaço disponível e as permissões.",
      );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
