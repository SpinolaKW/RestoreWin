import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole, Snowflake, ShieldCheck } from "lucide-react";
import type { AuthState } from "../shared/contracts";
import { bridge } from "./bridge";
import { App } from "./App";

export function AuthGate() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const result = await bridge.authState();
      if (result.ok) {
        setAuth(result.value);
        setError("");
      } else {
        setAuth(null);
        setError(result.message);
      }
    } catch {
      setAuth(null);
      setError("Não foi possível consultar o controle de acesso.");
    }
  }
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const remove = bridge.onLocked(() => {
      setAuth((old) => (old ? { ...old, user: null } : null));
      setPassword("");
      setConfirmation("");
      setError("");
      void refresh();
    });
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      remove();
    };
  }, []);
  async function lock() {
    setAuth((old) => (old ? { ...old, user: null } : null));
    setPassword("");
    setConfirmation("");
    await bridge.lock();
    await refresh();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!auth) return;
    if (!auth.initialized && (password !== confirmation || !acknowledged)) {
      setError("Confirme a senha e o aviso de guarda da senha.");
      return;
    }
    setBusy(true);
    try {
      const result = await (auth.initialized
        ? bridge.login(username, password)
        : bridge.setup(username, password));
      setPassword("");
      setConfirmation("");
      if (result.ok) setAuth(result.value);
      else setError(result.message);
    } catch {
      setPassword("");
      setConfirmation("");
      setError("Não foi possível entrar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  if (auth?.mode === "preview" || auth?.user)
    return (
      <App
        key={auth.user?.id ?? "preview"}
        user={auth.user}
        onLock={() => void lock()}
      />
    );
  const setup = auth && !auth.initialized;
  return (
    <div className="access-shell">
      <aside className="access-brand">
        <Snowflake size={48} />
        <h1>RestoreWin</h1>
        <p>Controle de acesso para a sua estação.</p>
        <div>
          <ShieldCheck size={24} />
          <strong>Seu espaço de administração</strong>
          <p>
            Feche a janela para bloquear o acesso. Abra novamente pelo ícone da
            bandeja ou pelo atalho do aplicativo.
          </p>
        </div>
        <small>A proteção por congelamento ainda não está disponível.</small>
      </aside>
      <main className="access-content">
        <section className="access-card">
          <span className="stat-icon mint">
            <LockKeyhole size={25} />
          </span>
          <h1>
            {setup
              ? "Criar administrador principal"
              : auth
                ? "Entrar no RestoreWin"
                : "Controle de acesso"}
          </h1>
          <p>
            {setup
              ? "Configure a conta responsável por gerenciar todos os usuários deste aplicativo."
              : "Entre para acessar as configurações. A sessão é bloqueada ao fechar a janela."}
          </p>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {auth ? (
            <form onSubmit={(e) => void submit(e)}>
              <label>
                Usuário
                <input
                  name="username"
                  autoComplete="username"
                  value={username}
                  maxLength={32}
                  required
                  disabled={busy}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete={setup ? "new-password" : "current-password"}
                  value={password}
                  minLength={setup ? 12 : undefined}
                  maxLength={128}
                  required
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {setup && (
                <>
                  <label>
                    Confirmar senha
                    <input
                      name="confirmation"
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      minLength={12}
                      maxLength={128}
                      required
                      disabled={busy}
                      onChange={(e) => setConfirmation(e.target.value)}
                    />
                  </label>
                  <small>
                    Use uma senha de 12 a 128 caracteres. O usuário aceita
                    letras, números, ponto, hífen e sublinhado (3 a 32
                    caracteres).
                  </small>
                  <div className="password-warning">
                    <strong>Não esqueça a senha.</strong>
                    <p>
                      O administrador principal não pode ser excluído ou
                      renomeado. Sua senha só pode ser alterada após entrar como
                      ele e confirmar a senha atual. Não há recuperação
                      automática de senha.
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        required
                        onChange={(e) => setAcknowledged(e.target.checked)}
                      />
                      Entendi e vou guardar a senha em local seguro.
                    </label>
                  </div>
                </>
              )}
              <button className="button primary" disabled={busy} type="submit">
                {busy ? "Aguarde…" : setup ? "Criar administrador" : "Entrar"}
              </button>
            </form>
          ) : (
            <button className="button secondary" onClick={() => void refresh()}>
              Tentar novamente
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
