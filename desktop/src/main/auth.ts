import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  access,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "./domain";
import type { AuthState, User } from "../shared/contracts";

const credentials = z
  .object({
    username: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/),
    password: z
      .string()
      .min(12)
      .max(128)
      .refine((s) => !s.includes("\0")),
  })
  .strict();
const recordSchema = z
  .object({
    id: z.string().uuid(),
    username: credentials.shape.username,
    role: z.enum(["admin", "operator"]),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    hash: z.string().regex(/^[a-f0-9]{128}$/),
  })
  .strict();
const databaseSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal("scrypt-32768-8-1"),
    firstAdminId: z.string().uuid(),
    users: z.array(recordSchema).min(1).max(50),
    failures: z.number().int().min(0).max(5),
    retryAfter: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((db, ctx) => {
    if (
      db.users.filter((u) => u.role === "admin").length !== 1 ||
      !db.users.some((u) => u.id === db.firstAdminId && u.role === "admin") ||
      new Set(db.users.map((u) => u.id)).size !== db.users.length ||
      new Set(db.users.map((u) => u.username.toLowerCase())).size !==
        db.users.length
    )
      ctx.addIssue({ code: "custom", message: "Invalid account database" });
  });
type Database = z.infer<typeof databaseSchema>;
type Record = z.infer<typeof recordSchema>;
const publicUser = (u: Record): User => ({
  id: u.id,
  username: u.username,
  role: u.role,
});
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(salt, "hex"),
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
async function secret(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: (await derive(password, salt)).toString("hex") };
}
function checked(username: unknown, password: unknown) {
  const value = credentials.safeParse({ username, password });
  if (!value.success)
    throw new AppError(
      "INVALID_CREDENTIALS_FORMAT",
      "Use um usuário de 3 a 32 caracteres (letras, números, ponto, hífen ou sublinhado) e uma senha de 12 a 128 caracteres.",
    );
  return value.data;
}

function storageError(
  error: unknown,
  operation: "read" | "write",
  filename: string,
): AppError {
  const raw = (error as NodeJS.ErrnoException | null)?.code;
  const nativeCode =
    typeof raw === "string" && /^[A-Z0-9_]{1,40}$/.test(raw) ? raw : "UNKNOWN";
  const guidance =
    nativeCode === "EACCES" || nativeCode === "EPERM"
      ? "O Windows ou outro componente recusou o acesso. Verifique as permissões e o histórico de proteção do Windows para este caminho. Preserve o cadastro existente."
      : nativeCode === "EISDIR" ||
          nativeCode === "ENOTDIR" ||
          nativeCode === "EEXIST"
        ? "O caminho contém um arquivo ou uma pasta onde outro tipo era esperado. Preserve os itens existentes e envie este diagnóstico antes de alterar o cadastro."
        : nativeCode === "EBUSY" || nativeCode === "ETXTBSY"
          ? "O arquivo pode estar em uso ou bloqueado. Feche outras instâncias e tente novamente."
          : nativeCode === "ENOSPC" || nativeCode === "EDQUOT"
            ? "Não há espaço ou cota disponível para salvar os usuários. Libere espaço sem excluir o cadastro."
            : nativeCode === "EROFS"
              ? "O local dos dados está somente para leitura. Verifique a unidade e suas permissões."
              : "Preserve os arquivos de usuários e envie este código e caminho para identificar a causa. A conta não será recriada automaticamente.";
  return new AppError(
    operation === "read" ? "ACCOUNTS_UNREADABLE" : "ACCOUNTS_WRITE_FAILED",
    operation === "read"
      ? "Não foi possível ler os usuários. O acesso permanece bloqueado."
      : "Não foi possível salvar os usuários. O armazenamento não pôde ser acessado.",
    { operation, nativeCode, path: filename, guidance },
  );
}

export class AuthService {
  readonly filename: string;
  private marker: string;
  private queue: Promise<unknown> = Promise.resolve();
  private session: { id: string; activeAt: number } | null = null;
  private generation = 0;
  private dummy = {
    salt: randomBytes(16).toString("hex"),
    hash: randomBytes(64).toString("hex"),
  };
  constructor(
    private directory: string,
    private now = () => Date.now(),
  ) {
    this.filename = path.join(directory, "accounts.json");
    this.marker = path.join(directory, "accounts.initialized");
  }
  lock() {
    this.session = null;
    this.generation++;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async load(): Promise<Database | null> {
    let raw: string;
    try {
      raw = await readFile(this.filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.lock();
        throw storageError(error, "read", this.filename);
      }
      try {
        await access(this.marker);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        this.lock();
        throw storageError(e, "read", this.marker);
      }
      this.lock();
      throw new AppError(
        "ACCOUNTS_DAMAGED",
        "O cadastro de usuários está ausente após sua inicialização. O acesso permanece bloqueado.",
        {
          operation: "read",
          nativeCode: "ENOENT",
          path: this.filename,
          guidance:
            "A marca de inicialização ainda existe. Preserve os arquivos; não haverá novo cadastro automático sobre um administrador existente.",
        },
      );
    }
    try {
      if (Buffer.byteLength(raw) > 128 * 1024) throw Error("Too large");
      return databaseSchema.parse(JSON.parse(raw));
    } catch {
      this.lock();
      throw new AppError(
        "ACCOUNTS_DAMAGED",
        "O cadastro de usuários está inválido e foi preservado. O acesso permanece bloqueado.",
        {
          operation: "read",
          nativeCode: "INVALID_FORMAT",
          path: this.filename,
          guidance:
            "O conteúdo não corresponde ao cadastro esperado. Preserve o arquivo para diagnóstico ou restaure uma cópia válida. Não envie seu conteúdo pelo chat.",
        },
      );
    }
  }
  private async save(db: Database) {
    const value = databaseSchema.parse(db);
    const temp = path.join(this.directory, `accounts.${randomUUID()}.tmp`);
    let destination = this.directory;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      destination = this.filename;
      const f = await open(temp, "wx", 0o600);
      try {
        await f.writeFile(JSON.stringify(value) + "\n");
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(temp, this.filename);
      destination = this.marker;
      const marker = await open(this.marker, "a", 0o600);
      try {
        await marker.sync();
      } finally {
        await marker.close();
      }
    } catch (error) {
      throw storageError(error, "write", destination);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
  private current(db: Database, admin = false, touch = true): User {
    if (!this.session || this.now() - this.session.activeAt >= 15 * 60 * 1000) {
      this.lock();
      throw new AppError(
        "AUTH_REQUIRED",
        "Entre com seu usuário e senha para continuar.",
      );
    }
    const user = db.users.find((u) => u.id === this.session!.id);
    if (!user) {
      this.lock();
      throw new AppError("AUTH_REQUIRED", "Sua sessão foi encerrada.");
    }
    if (admin && user.id !== db.firstAdminId)
      throw new AppError(
        "ADMIN_REQUIRED",
        "Esta ação exige o administrador principal.",
      );
    if (touch) this.session.activeAt = this.now();
    return publicUser(user);
  }
  async require(admin = false): Promise<User> {
    const db = await this.load();
    if (!db)
      throw new AppError(
        "AUTH_REQUIRED",
        "Crie o administrador principal antes de continuar.",
      );
    return this.current(db, admin);
  }
  async state(): Promise<AuthState> {
    const db = await this.load();
    let user: User | null = null;
    if (db && this.session) {
      try {
        user = this.current(db, false, false);
      } catch (e) {
        if (!(e instanceof AppError) || e.code !== "AUTH_REQUIRED") throw e;
      }
    }
    return { mode: "desktop", initialized: db !== null, user };
  }
  setup(username: unknown, password: unknown): Promise<AuthState> {
    const epoch = this.generation;
    return this.serial(async () => {
      if (await this.load())
        throw new AppError(
          "ALREADY_INITIALIZED",
          "O administrador principal já foi criado.",
        );
      const value = checked(username, password),
        id = randomUUID();
      const account = {
        id,
        username: value.username,
        role: "admin" as const,
        ...(await secret(value.password)),
      };
      await this.save({
        version: 1,
        algorithm: "scrypt-32768-8-1",
        firstAdminId: id,
        users: [account],
        failures: 0,
        retryAfter: 0,
      });
      if (epoch === this.generation)
        this.session = { id, activeAt: this.now() };
      return this.state();
    });
  }
  private async verify(
    db: Database,
    account: Record | undefined,
    password: string,
  ) {
    if (db.retryAfter > this.now())
      throw new AppError(
        "AUTH_THROTTLED",
        "Muitas tentativas. Aguarde um minuto antes de tentar novamente.",
      );
    const candidate = account ?? this.dummy;
    const key = await derive(password, candidate.salt);
    if (!timingSafeEqual(key, Buffer.from(candidate.hash, "hex")) || !account) {
      db.failures = Math.min(5, db.failures + 1);
      db.retryAfter = db.failures >= 5 ? this.now() + 60_000 : 0;
      await this.save(db);
      throw new AppError("INVALID_CREDENTIALS", "Usuário ou senha inválidos.");
    }
  }
  login(username: unknown, password: unknown): Promise<AuthState> {
    const epoch = this.generation;
    return this.serial(async () => {
      const db = await this.load();
      if (!db)
        throw new AppError("SETUP_REQUIRED", "Crie o administrador principal.");
      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        username.length > 128 ||
        password.length > 128
      )
        throw new AppError(
          "INVALID_CREDENTIALS",
          "Usuário ou senha inválidos.",
        );
      const account = db.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase(),
      );
      await this.verify(db, account, password);
      db.failures = 0;
      db.retryAfter = 0;
      await this.save(db);
      if (epoch === this.generation)
        this.session = { id: account!.id, activeAt: this.now() };
      return this.state();
    });
  }
  async users(): Promise<User[]> {
    const db = await this.load();
    if (!db) throw new AppError("AUTH_REQUIRED", "Entre como administrador.");
    this.current(db, true);
    return db.users.map(publicUser);
  }
  createUser(username: unknown, password: unknown): Promise<User[]> {
    return this.serial(async () => {
      const db = await this.load();
      if (!db) throw new AppError("AUTH_REQUIRED", "Entre como administrador.");
      this.current(db, true);
      const epoch = this.generation,
        value = checked(username, password);
      if (db.users.length >= 50)
        throw new AppError(
          "USER_LIMIT",
          "O limite de 50 usuários foi atingido.",
        );
      if (
        db.users.some(
          (u) => u.username.toLowerCase() === value.username.toLowerCase(),
        )
      )
        throw new AppError("DUPLICATE_USER", "Esse nome de usuário já existe.");
      const entry = {
        id: randomUUID(),
        username: value.username,
        role: "operator" as const,
        ...(await secret(value.password)),
      };
      if (epoch !== this.generation)
        throw new AppError("AUTH_REQUIRED", "Entre novamente para continuar.");
      this.current(db, true);
      db.users.push(entry);
      await this.save(db);
      return db.users.map(publicUser);
    });
  }
  changePassword(
    id: unknown,
    password: unknown,
    currentPassword: unknown,
  ): Promise<AuthState> {
    return this.serial(async () => {
      const db = await this.load();
      if (!db) throw new AppError("AUTH_REQUIRED", "Entre como administrador.");
      this.current(db, true);
      const epoch = this.generation;
      const user = db.users.find((u) => u.id === id);
      if (!user) throw new AppError("USER_MISSING", "Usuário não encontrado.");
      const value = checked(user.username, password);
      if (user.id === db.firstAdminId) {
        if (typeof currentPassword !== "string" || currentPassword.length > 128)
          throw new AppError(
            "INVALID_CREDENTIALS",
            "Confirme sua senha atual.",
          );
        await this.verify(db, user, currentPassword);
      }
      const next = await secret(value.password);
      if (epoch !== this.generation)
        throw new AppError("AUTH_REQUIRED", "Entre novamente para continuar.");
      this.current(db, true);
      Object.assign(user, next);
      if (user.id === db.firstAdminId) {
        db.failures = 0;
        db.retryAfter = 0;
      }
      await this.save(db);
      if (user.id === db.firstAdminId) this.lock();
      return this.state();
    });
  }
  deleteUser(id: unknown): Promise<User[]> {
    return this.serial(async () => {
      const db = await this.load();
      if (!db) throw new AppError("AUTH_REQUIRED", "Entre como administrador.");
      this.current(db, true);
      if (id === db.firstAdminId)
        throw new AppError(
          "PRIMARY_ADMIN_PROTECTED",
          "O administrador principal não pode ser excluído ou renomeado.",
        );
      const index = db.users.findIndex((u) => u.id === id);
      if (index < 0)
        throw new AppError("USER_MISSING", "Usuário não encontrado.");
      db.users.splice(index, 1);
      await this.save(db);
      return db.users.map(publicUser);
    });
  }
}
