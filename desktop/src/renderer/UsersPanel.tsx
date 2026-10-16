import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { bridge } from "./bridge";
import type { RuntimeState, User } from "../shared/contracts";

export function UsersPanel({ current }: { current: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  async function refresh() {
    const [list, info] = await Promise.all([bridge.users(), bridge.runtime()]);
    if (list.ok) setUsers(list.value);
    else setMessage({ text: list.message, error: true });
    if (info.ok) setRuntime(info.value);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage({
        text: "Não foi possível consultar os usuários.",
        error: true,
      }),
    );
  }, []);
  function reset(target: User | "new" | null) {
    setEditing(target);
    setUsername("");
    setPassword("");
    setConfirmation("");
    setOldPassword("");
    setMessage(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (password !== confirmation) {
      setMessage({ text: "As senhas não conferem.", error: true });
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") {
        const result = await bridge.createUser(username, password);
        if (!result.ok) {
          setMessage({ text: result.message, error: true });
          return;
        }
        setUsers(result.value);
      } else if (editing) {
        const result = await bridge.changePassword(
          editing.id,
          password,
          oldPassword,
        );
        if (!result.ok) {
          setMessage({ text: result.message, error: true });
          return;
        }
      }
      reset(null);
      setMessage({
        text: "Usuário atualizado. Na troca da senha principal, entre novamente com a nova senha.",
        error: false,
      });
    } catch {
      setMessage({ text: "Não foi possível salvar o usuário.", error: true });
    } finally {
      setBusy(false);
      setPassword("");
      setConfirmation("");
      setOldPassword("");
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await bridge.deleteUser(deleting.id);
      if (result.ok) {
        setUsers(result.value);
        setDeleting(null);
        setMessage({ text: "Usuário excluído.", error: false });
      } else setMessage({ text: result.message, error: true });
    } catch {
      setMessage({ text: "Não foi possível excluir o usuário.", error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="users-area">
      {message && (
        <div
          className={`notice ${message.error ? "error" : "success"}`}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </div>
      )}
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Usuários do aplicativo</h2>
            <p>
              Somente o administrador principal pode cadastrar usuários, trocar
              senhas e excluir contas.
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => reset("new")}
            disabled={busy}
          >
            <Plus size={17} />
            Novo usuário
          </button>
        </div>
        <div className="password-warning">
          <ShieldCheck size={20} />
          <div>
            <strong>Não esqueça a senha do administrador principal.</strong>
            <p>
              O nome e a conta principal são permanentes. Apenas o próprio
              administrador, após entrar e confirmar sua senha atual, pode
              trocar essa senha.
            </p>
          </div>
        </div>
        <div className="user-list">
          {users.map((user) => (
            <div className="user-row" key={user.id}>
              <div>
                <strong>{user.username}</strong>
                <small>
                  {user.role === "admin"
                    ? "Administrador principal · conta protegida"
                    : "Operador · configurações do aplicativo"}
                </small>
              </div>
              <div className="user-actions">
                <button
                  className="button secondary"
                  onClick={() => reset(user)}
                  disabled={busy}
                >
                  <KeyRound size={16} />
                  Alterar senha de {user.username}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Excluir usuário ${user.username}`}
                  disabled={busy || user.role === "admin"}
                  onClick={() => setDeleting(user)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {editing && (
        <section
          className="panel"
          aria-label={editing === "new" ? "Cadastrar usuário" : "Alterar senha"}
        >
          <h2>
            {editing === "new"
              ? "Cadastrar usuário"
              : `Alterar senha de ${editing.username}`}
          </h2>
          <form className="user-form" onSubmit={(e) => void submit(e)}>
            {editing === "new" && (
              <label>
                Nome do novo usuário
                <input
                  autoComplete="off"
                  required
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}"
                  maxLength={32}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            {editing !== "new" && editing.id === current.id && (
              <label>
                Senha atual do administrador
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <label>
              Nova senha
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Confirmar nova senha
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={busy}
              />
            </label>
            <small>
              Senha de 12 a 128 caracteres. Os nomes cadastrados não podem ser
              alterados.
            </small>
            <div className="user-actions">
              <button type="submit" className="button primary" disabled={busy}>
                Salvar usuário
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => reset(null)}
              >
                Cancelar edição
              </button>
            </div>
          </form>
        </section>
      )}
      {deleting && (
        <section
          className="panel"
          role="dialog"
          aria-label="Confirmar exclusão"
        >
          <h2>Excluir {deleting.username}?</h2>
          <p>
            Essa conta perderá o acesso ao aplicativo. O administrador principal
            permanece intacto.
          </p>
          <div className="user-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Confirmar exclusão
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancelar exclusão
            </button>
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Segundo plano e inicialização</h2>
        <p>
          Use contas Windows padrão para os alunos. Estas senhas controlam o
          acesso ao aplicativo e não substituem as permissões do Windows.
        </p>
        <p>
          {runtime?.trayAvailable
            ? "Fechar pelo X bloqueia a sessão e mantém o aplicativo na bandeja. Para reabrir, clique no ícone ou execute o atalho novamente."
            : "A bandeja não está disponível nesta sessão. Fechar bloqueia o acesso e minimiza a janela para manter um caminho de reabertura."}
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={runtime?.autoStart ?? false}
            disabled={busy || !runtime?.autoStartSupported}
            onChange={async (e) => {
              setBusy(true);
              try {
                const r = await bridge.setAutoStart(e.target.checked);
                if (r.ok) setRuntime(r.value);
                else setMessage({ text: r.message, error: true });
              } catch {
                setMessage({
                  text: "Não foi possível configurar a inicialização automática.",
                  error: true,
                });
              } finally {
                setBusy(false);
              }
            }}
          />
          Iniciar com o Windows, na bandeja
        </label>
        {!runtime?.autoStartSupported && (
          <small>Disponível no aplicativo instalado no Windows.</small>
        )}
        <p>
          Para encerrar completamente, entre como administrador e utilize o menu
          da bandeja ou o botão abaixo.
        </p>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            const r = await bridge.quit();
            if (!r.ok) setMessage({ text: r.message, error: true });
          }}
        >
          Encerrar aplicativo
        </button>
      </section>
    </section>
  );
}
