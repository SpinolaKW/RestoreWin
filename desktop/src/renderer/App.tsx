import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Computer,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  LockKeyhole,
  MonitorCog,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Shield,
  ShieldCheck,
  Snowflake,
  Trash2,
  TriangleAlert,
  UnlockKeyhole,
  Wrench,
  X,
  Users,
} from "lucide-react";
import type { Profile, Screen, Snapshot, User } from "../shared/contracts";
import { bridge } from "./bridge";
import { UsersPanel } from "./UsersPanel";

const nav = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "folders", label: "Pastas permanentes", icon: FolderOpen },
  { id: "volumes", label: "Discos e instalação", icon: HardDrive },
  { id: "maintenance", label: "Manutenção", icon: Wrench },
  { id: "activity", label: "Atividade", icon: ActivityIcon },
] as const;
const titles: Record<Screen, string> = {
  overview: "Visão geral",
  folders: "Pastas permanentes",
  volumes: "Discos e instalação",
  maintenance: "Manutenção",
  activity: "Atividade",
  users: "Usuários e acesso",
};

function bytes(n: number) {
  return (
    new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
      n / 1024 ** 3,
    ) + " GB"
  );
}
function date(s: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(s));
}
function Modal({
  title,
  open,
  close,
  children,
}: {
  title: string;
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={close} aria-label={title}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Fechar janela"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function App({
  user,
  onLock,
}: {
  user: User | null;
  onLock: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [screen, setScreen] = useState<Screen>("overview");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [installDialog, setInstallDialog] = useState(false);
  const [helpDialog, setHelpDialog] = useState(false);
  const started = useRef(false);

  async function refresh(reset = false) {
    setBusy(true);
    try {
      const result = await bridge.snapshot();
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setLoadError("");
      if (
        !reset &&
        dirty &&
        snapshot &&
        result.value.settings.revision !== snapshot.settings.revision
      ) {
        setSnapshot({ ...result.value, settings: snapshot.settings });
        setNotice({
          text: "O perfil salvo mudou. Descarte as alterações locais para recarregá-lo antes de salvar.",
          error: true,
        });
      } else {
        setSnapshot(result.value);
        if (reset || !dirty)
          setDraft(structuredClone(result.value.settings.profile));
      }
    } catch {
      setLoadError("Não foi possível consultar o computador. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void refresh(true);
    }
  }, []);

  async function save() {
    if (!snapshot || !draft) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await bridge.saveProfile(
        draft,
        snapshot.settings.revision,
      );
      if (!result.ok) {
        setNotice({ text: result.message, error: true });
        return;
      }
      setSnapshot(result.value);
      setDraft(structuredClone(result.value.settings.profile));
      setNotice({
        text:
          snapshot.mode === "preview"
            ? "Configuração de exemplo salva no navegador. Nenhuma proteção foi ativada."
            : "Configuração salva. O estado da proteção não foi alterado.",
        error: false,
      });
    } catch {
      setNotice({
        text: "Falha ao salvar. Suas alterações continuam no formulário.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  function addFolder(value: string) {
    if (!draft || !snapshot) return;
    const selected = snapshot.computer.volumes.filter((v) =>
      draft.protectedVolumeIds.includes(v.id),
    );
    const windows = snapshot.computer.platform === "windows";
    const normalized = windows
      ? value.replace(/[\\/]+$/, "").toLowerCase()
      : value.replace(/\/+$/, "");
    if (
      !normalized ||
      draft.exclusions.some(
        (f) =>
          (windows ? f.path.toLowerCase() : f.path).replace(/[\\/]+$/, "") ===
          normalized,
      )
    ) {
      setNotice({
        text: "Selecione uma pasta nova, sem repetir as que já estão na lista.",
        error: true,
      });
      return;
    }
    if (
      !selected.some((v) =>
        windows
          ? value.toLowerCase().startsWith(v.mountPoint.toLowerCase())
          : value.startsWith(
              v.mountPoint === "/"
                ? "/"
                : `${v.mountPoint.replace(/\/$/, "")}/`,
            ),
      )
    ) {
      setNotice({
        text: "Escolha uma pasta dentro de uma unidade selecionada.",
        error: true,
      });
      return;
    }
    setDraft({
      ...draft,
      exclusions: [
        ...draft.exclusions,
        { id: crypto.randomUUID(), path: value },
      ],
    });
    setFolderDialog(false);
    setFolderPath("");
  }
  async function chooseFolder() {
    if (!draft?.protectedVolumeIds.length) {
      setNotice({
        text: "Primeiro, selecione uma unidade em Discos e instalação.",
        error: true,
      });
      return;
    }
    if (snapshot?.mode === "preview") {
      setFolderDialog(true);
      return;
    }
    try {
      const result = await bridge.chooseFolder();
      if (!result.ok) setNotice({ text: result.message, error: true });
      else if (result.value) addFolder(result.value);
    } catch {
      setNotice({
        text: "Não foi possível abrir o seletor de pastas.",
        error: true,
      });
    }
  }
  async function protection(action: "freeze" | "thaw") {
    setBusy(true);
    try {
      const result = await bridge.requestProtection(action);
      if (!result.ok) setNotice({ text: result.message, error: true });
      else setSnapshot(result.value);
    } catch {
      setNotice({
        text: "Não foi possível confirmar a operação. Consulte novamente o estado antes de continuar.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const dirty = Boolean(
    snapshot &&
    draft &&
    JSON.stringify(draft) !== JSON.stringify(snapshot.settings.profile),
  );
  const ready = Boolean(snapshot && draft);
  const selectedCount = draft?.protectedVolumeIds.length ?? 0;
  const frozen = snapshot?.protection.phase === "frozen";
  const phaseLabel = frozen
    ? "Congelamento confirmado"
    : snapshot?.protection.phase === "thawed"
      ? "Modo manutenção confirmado"
      : snapshot?.protection.phase === "pending-freeze"
        ? "Congelamento pendente de reinicialização"
        : snapshot?.protection.phase === "pending-thaw"
          ? "Manutenção pendente de reinicialização"
          : "Proteção indisponível";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            setScreen("overview");
          }}
          aria-label="RestoreWin — visão geral"
        >
          <span className="brand-symbol">
            <Snowflake size={25} strokeWidth={1.8} />
          </span>
          <span>
            Restore<span className="brand-light">Win</span>
            <small>SYSTEM FREEZE</small>
          </span>
        </a>
        <span className="nav-caption">ESPAÇO DE TRABALHO</span>
        <nav aria-label="Navegação principal">
          {nav.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${screen === item.id ? "selected" : ""}`}
              onClick={() => setScreen(item.id)}
              aria-current={screen === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "folders" && Boolean(draft?.exclusions.length) && (
                <span className="nav-count">{draft?.exclusions.length}</span>
              )}
            </button>
          ))}
          {user?.role === "admin" && (
            <button
              className={`nav-item ${screen === "users" ? "selected" : ""}`}
              onClick={() => setScreen("users")}
            >
              <Users size={19} />
              <span>Usuários e acesso</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          {user && (
            <button className="nav-item" onClick={onLock}>
              <LockKeyhole size={19} />
              <span>Bloquear acesso · {user.username}</span>
            </button>
          )}
          <div className="edition-tag">
            <span className="status-dot" /> Edição em desenvolvimento
          </div>
          <button className="nav-item" onClick={() => setHelpDialog(true)}>
            <CircleHelp size={19} />
            <span>Sobre e compatibilidade</span>
          </button>
          <div className="sidebar-version">
            RestoreWin <span>v{snapshot?.appVersion ?? "0.2.0"}</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Meu computador <ChevronRight size={14} />
            <strong>{titles[screen]}</strong>
          </div>
          <div className="topbar-status">
            <span className={`status-dot ${frozen ? "green" : "amber"}`} />
            {phaseLabel}
          </div>
        </header>
        {snapshot?.mode === "preview" && (
          <div className="preview-banner">
            <MonitorCog size={16} />
            <span>
              <strong>Prévia da interface.</strong> Os discos são exemplos;
              nenhuma configuração real do computador será alterada.
            </span>
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">CONTROLE DO SISTEMA</div>
              <h1>{titles[screen]}</h1>
              <p>
                {screen === "overview"
                  ? "Uma base de trabalho. Um recomeço a cada reinicialização."
                  : screen === "folders"
                    ? "Escolha os dados que deverão continuar salvos após reiniciar."
                    : screen === "volumes"
                      ? "Defina as unidades e conheça o local de instalação do aplicativo."
                      : screen === "maintenance"
                        ? "Planeje atualizações sem perder as alterações que deseja manter."
                        : screen === "users"
                          ? "Gerencie usuários, senhas e a execução em segundo plano."
                          : "Acompanhe as configurações salvas e os estados confirmados."}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => void refresh(!draft)}
              disabled={busy}
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
              Verificar computador
            </button>
          </div>
          {notice && (
            <div
              className={`notice ${notice.error ? "error" : "success"}`}
              role={notice.error ? "alert" : "status"}
            >
              {notice.error ? <TriangleAlert size={18} /> : <Check size={18} />}
              <span>{notice.text}</span>
              <button
                className="icon-button"
                onClick={() => setNotice(null)}
                aria-label="Dispensar mensagem"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loadError && (
            <div className="notice error" role="alert">
              <TriangleAlert size={18} />
              <span>{loadError}</span>
              <button
                className="text-button"
                onClick={() => void refresh(true)}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {!ready && !loadError && (
            <div className="loading">
              <RefreshCw className="spin" />
              Consultando configuração e unidades…
            </div>
          )}
          {ready && snapshot && draft && (
            <>
              <div className="development-note">
                <TriangleAlert size={17} />
                <span>
                  <strong>
                    O computador ainda não está protegido pelo RestoreWin.
                  </strong>{" "}
                  O mecanismo de congelamento não está implementado nesta
                  versão. Você pode salvar a configuração, mas ativar ou
                  desativar a proteção ainda não está disponível.
                </span>
              </div>
              {screen === "users" && user?.role === "admin" && (
                <UsersPanel current={user} />
              )}
              {screen === "overview" && (
                <>
                  <section
                    className={`freeze-card ${frozen ? "is-frozen" : ""}`}
                  >
                    <div className="freeze-main">
                      <span className="section-label">ESTADO DA PROTEÇÃO</span>
                      <div className="freeze-title">
                        <div className="freeze-emblem">
                          <Shield size={38} strokeWidth={1.5} />
                          <span>
                            <LockKeyhole size={16} />
                          </span>
                        </div>
                        <div>
                          <h2>{phaseLabel}</h2>
                          <p>
                            {frozen
                              ? "As alterações da sessão serão descartadas ao reiniciar, exceto nas pastas permanentes."
                              : "Prepare sua base e as pastas permanentes. O congelamento depende de um componente de proteção validado para o seu sistema."}
                          </p>
                        </div>
                      </div>
                      <div className="freeze-actions">
                        <button
                          className="button primary"
                          onClick={() => void protection("freeze")}
                          disabled={
                            busy || dirty || !snapshot.protection.canFreeze
                          }
                        >
                          <Snowflake size={17} />
                          Ativar congelamento
                        </button>
                        <button
                          className="button ghost"
                          onClick={() => setScreen("maintenance")}
                        >
                          <Wrench size={16} />
                          Abrir manutenção
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="freeze-info">
                      <span className="mini-icon">
                        <RefreshCw size={22} />
                      </span>
                      <h3>Reiniciar. Restaurar. Continuar.</h3>
                      <p>
                        Durante o congelamento, as mudanças ficam na sessão. Ao
                        reiniciar, o sistema deverá voltar à base que você
                        escolheu.
                      </p>
                      <span className="small-tag">FUNÇÃO PLANEJADA</span>
                    </div>
                  </section>
                  <div className="stats-grid">
                    <div className="stat">
                      <span className="stat-icon violet">
                        <ShieldCheck size={20} />
                      </span>
                      <div>
                        <span>Base confirmada</span>
                        <strong>
                          {snapshot.protection.confirmedBaseline ??
                            "Nenhuma base ativa"}
                        </strong>
                        <small>
                          {snapshot.protection.confirmedBaseline
                            ? "Informada pelo componente de proteção"
                            : "Configuração salva não equivale a congelamento"}
                        </small>
                      </div>
                    </div>
                    <button
                      className="stat stat-link"
                      onClick={() => setScreen("volumes")}
                    >
                      <span className="stat-icon blue">
                        <HardDrive size={20} />
                      </span>
                      <div>
                        <span>Unidades selecionadas</span>
                        <strong>
                          {selectedCount}{" "}
                          {selectedCount === 1 ? "unidade" : "unidades"}
                        </strong>
                        <small>Preparadas no perfil de configuração</small>
                      </div>
                      <ChevronRight size={17} />
                    </button>
                    <button
                      className="stat stat-link"
                      onClick={() => setScreen("folders")}
                    >
                      <span className="stat-icon mint">
                        <Folder size={20} />
                      </span>
                      <div>
                        <span>Pastas permanentes</span>
                        <strong>
                          {draft.exclusions.length}{" "}
                          {draft.exclusions.length === 1 ? "pasta" : "pastas"}
                        </strong>
                        <small>Exclusões planejadas para seus dados</small>
                      </div>
                      <ChevronRight size={17} />
                    </button>
                  </div>
                  <div className="two-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Seu próximo ponto de partida</h2>
                          <p>Identifique a base que deseja preparar.</p>
                        </div>
                        <span className="panel-icon">
                          <Settings2 size={20} />
                        </span>
                      </div>
                      <label className="field-label" htmlFor="baseline-name">
                        Nome da próxima base
                      </label>
                      <input
                        id="baseline-name"
                        value={draft.baselineName}
                        maxLength={80}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            baselineName: event.target.value,
                          })
                        }
                      />
                      <div className="field-hint">
                        <CircleHelp size={14} />O nome será usado quando uma
                        base real puder ser criada.
                      </div>
                      <div className="detail-line">
                        <span>Sistema detectado</span>
                        <strong>{snapshot.computer.osName}</strong>
                      </div>
                      <div className="detail-line">
                        <span>Versão / arquitetura</span>
                        <strong>
                          {snapshot.computer.osVersion} ·{" "}
                          {snapshot.computer.architecture}
                        </strong>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Como o congelamento deverá funcionar</h2>
                          <p>
                            Um fluxo simples, com o estado sempre confirmado.
                          </p>
                        </div>
                      </div>
                      <ol className="steps">
                        <li>
                          <span>1</span>
                          <div>
                            <strong>Prepare e congele</strong>
                            <p>
                              Configure o sistema e escolha uma base
                              consistente.
                            </p>
                          </div>
                        </li>
                        <li>
                          <span>2</span>
                          <div>
                            <strong>Use normalmente</strong>
                            <p>
                              As alterações da sessão ficam temporárias; suas
                              pastas permanentes preservam os dados.
                            </p>
                          </div>
                        </li>
                        <li>
                          <span>3</span>
                          <div>
                            <strong>Reinicie para restaurar</strong>
                            <p>
                              O componente de proteção deverá confirmar o
                              retorno à base.
                            </p>
                          </div>
                        </li>
                      </ol>
                    </section>
                  </div>
                </>
              )}
              {screen === "folders" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Pastas que deverão permanecer salvas</h2>
                      <p>
                        Documentos e dados dessas pastas deverão ficar fora da
                        restauração.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => void chooseFolder()}
                      disabled={busy}
                    >
                      <Plus size={17} />
                      Adicionar pasta
                    </button>
                  </div>
                  {draft.exclusions.length === 0 ? (
                    <div className="empty-state">
                      <span>
                        <FolderOpen size={33} />
                      </span>
                      <h3>Nenhuma pasta adicionada</h3>
                      <p>
                        Selecione uma unidade e adicione pastas de dados que
                        deseja preservar. As exclusões só terão efeito quando a
                        proteção estiver disponível e confirmada.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setScreen("volumes")}
                      >
                        Escolher unidades
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="folder-list">
                      {draft.exclusions.map((folder) => (
                        <div className="folder-row" key={folder.id}>
                          <span className="folder-icon">
                            <Folder size={22} />
                          </span>
                          <div>
                            <strong>
                              {folder.path.split(/[\\/]/).filter(Boolean).pop()}
                            </strong>
                            <code>{folder.path}</code>
                          </div>
                          <span className="small-tag">CONFIGURADA</span>
                          <button
                            className="icon-button danger"
                            aria-label={`Remover pasta ${folder.path}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                exclusions: draft.exclusions.filter(
                                  (f) => f.id !== folder.id,
                                ),
                              })
                            }
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="panel-footer">
                    <CircleHelp size={16} />
                    <span>
                      Pastas essenciais do sistema e raízes de unidades não
                      podem ser excluídas. Dados da configuração não são uma
                      confirmação de proteção ativa.
                    </span>
                  </div>
                </section>
              )}
              {screen === "volumes" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Unidades para congelar</h2>
                        <p>
                          A seleção prepara o perfil; não altera o estado dessas
                          unidades.
                        </p>
                      </div>
                      <span className="small-tag">
                        {snapshot.computer.volumes.length} DISPONÍVEIS
                      </span>
                    </div>
                    <div className="volumes-grid">
                      {snapshot.computer.volumes.map((volume) => (
                        <label
                          className={`volume-card ${draft.protectedVolumeIds.includes(volume.id) ? "volume-selected" : ""}`}
                          key={volume.id}
                        >
                          <div className="volume-top">
                            <span className="drive-icon">
                              <HardDrive size={25} />
                            </span>
                            <input
                              type="checkbox"
                              aria-label={`Selecionar unidade ${volume.label} ${volume.mountPoint}`}
                              checked={draft.protectedVolumeIds.includes(
                                volume.id,
                              )}
                              disabled={
                                volume.readOnly !== false &&
                                !draft.protectedVolumeIds.includes(volume.id)
                              }
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  protectedVolumeIds: event.target.checked
                                    ? [...draft.protectedVolumeIds, volume.id]
                                    : draft.protectedVolumeIds.filter(
                                        (id) => id !== volume.id,
                                      ),
                                })
                              }
                            />
                          </div>
                          <h3>
                            {volume.label}
                            <span>{volume.system ? "SISTEMA" : "DADOS"}</span>
                          </h3>
                          <code>{volume.mountPoint}</code>
                          <div className="storage-bar">
                            <span
                              style={{
                                width: `${volume.totalBytes ? Math.min(100, Math.max(0, 100 * (1 - volume.freeBytes / volume.totalBytes))) : 0}%`,
                              }}
                            />
                          </div>
                          <div className="storage-details">
                            <span>{bytes(volume.freeBytes)} livres</span>
                            <strong>{bytes(volume.totalBytes)}</strong>
                          </div>
                          <div className="volume-meta">
                            {volume.filesystem} <span>·</span>{" "}
                            {volume.readOnly === null
                              ? "Acesso de escrita não verificado"
                              : volume.readOnly
                                ? "Somente leitura"
                                : "Leitura e gravação"}
                          </div>
                        </label>
                      ))}
                    </div>
                    {draft.protectedVolumeIds
                      .filter(
                        (id) =>
                          !snapshot.computer.volumes.some((v) => v.id === id),
                      )
                      .map((id) => (
                        <div className="notice warning" key={id}>
                          <HardDrive size={18} />
                          <span>
                            Uma unidade selecionada está indisponível.{" "}
                            <small title={id}>{id.slice(0, 30)}</small>
                          </span>
                          <button
                            className="text-button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                protectedVolumeIds:
                                  draft.protectedVolumeIds.filter(
                                    (v) => v !== id,
                                  ),
                              })
                            }
                          >
                            Remover seleção
                          </button>
                        </div>
                      ))}
                    {!snapshot.computer.volumes.length && (
                      <div className="empty-state">
                        <HardDrive size={30} />
                        <h3>Nenhuma unidade disponível</h3>
                        <p>
                          Confira o diagnóstico e tente consultar novamente.
                        </p>
                      </div>
                    )}
                  </section>
                  <section className="panel installation-panel">
                    <span className="stat-icon violet">
                      <ArrowDownToLine size={22} />
                    </span>
                    <div>
                      <h2>Local de instalação do aplicativo</h2>
                      <p>
                        O disco onde o programa fica instalado é independente
                        das unidades selecionadas para congelamento.
                      </p>
                      <code>{snapshot.computer.installationDirectory}</code>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setInstallDialog(true)}
                    >
                      Como escolher
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  {snapshot.computer.diagnosticWarnings.map((warning) => (
                    <div className="notice warning" key={warning}>
                      <TriangleAlert size={18} />
                      <span>{warning}</span>
                    </div>
                  ))}
                </>
              )}
              {screen === "maintenance" && (
                <>
                  <section className="panel maintenance-hero">
                    <span className="maintenance-icon">
                      <Wrench size={34} />
                    </span>
                    <div>
                      <span className="section-label">
                        ATUALIZAÇÕES E AJUSTES
                      </span>
                      <h2>Manutenção com alterações permanentes</h2>
                      <p>
                        Descongele, instale atualizações de programas e drivers
                        e prepare uma nova base antes de voltar a proteger o
                        computador.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => void protection("thaw")}
                      disabled={busy || !snapshot.protection.canThaw}
                    >
                      <UnlockKeyhole size={17} />
                      Descongelar para manutenção
                    </button>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Fluxo de manutenção planejado</h2>
                        <p>
                          Estas etapas descrevem o funcionamento desejado.
                          Nenhuma delas foi executada.
                        </p>
                      </div>
                      <span className="small-tag">AINDA INDISPONÍVEL</span>
                    </div>
                    <ol className="maintenance-steps">
                      <li>
                        <span>
                          <UnlockKeyhole size={20} />
                        </span>
                        <h3>Descongelar</h3>
                        <p>
                          Solicitar a manutenção e confirmar o estado após a
                          reinicialização necessária.
                        </p>
                      </li>
                      <li>
                        <span>
                          <RefreshCw size={20} />
                        </span>
                        <h3>Atualizar e verificar</h3>
                        <p>
                          Instalar atualizações do sistema, aplicativos e
                          drivers. Reiniciar e conferir o funcionamento.
                        </p>
                      </li>
                      <li>
                        <span>
                          <CheckCheck size={20} />
                        </span>
                        <h3>Criar a nova base</h3>
                        <p>
                          Consolidar um estado consistente e confirmar a
                          proteção antes de encerrar a manutenção.
                        </p>
                      </li>
                    </ol>
                    <div className="panel-footer">
                      <Shield size={17} />
                      <span>
                        O projeto prevê manutenção para atualizações. Bloquear
                        permanentemente o Windows Update não faz parte da
                        solução.
                      </span>
                    </div>
                  </section>
                </>
              )}
              {screen === "activity" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Histórico da configuração</h2>
                      <p>
                        Eventos do aplicativo, com distinção entre configuração
                        e proteção.
                      </p>
                    </div>
                    <span className="small-tag">
                      {snapshot.settings.activity.length} EVENTOS
                    </span>
                  </div>
                  {!snapshot.settings.activity.length ? (
                    <div className="empty-state">
                      <Clock3 size={32} />
                      <h3>Seu histórico começa aqui</h3>
                      <p>
                        Ao salvar uma configuração, o aplicativo registra o
                        evento. Nenhum congelamento foi confirmado.
                      </p>
                    </div>
                  ) : (
                    <div className="activity-list">
                      {snapshot.settings.activity.map((item) => (
                        <div className="activity-row" key={item.id}>
                          <span className={`activity-icon ${item.kind}`}>
                            <Check size={18} />
                          </span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                            <time dateTime={item.time}>{date(item.time)}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <footer className="workspace-footer">
                <span>
                  <Computer size={15} />
                  {snapshot.computer.osName}
                  <span className="footer-divider" />
                  {snapshot.mode === "preview"
                    ? "Dados de exemplo"
                    : "Diagnóstico local"}
                </span>
                <span>
                  {dirty ? (
                    <>
                      <span className="unsaved-dot" />
                      Alterações não salvas
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      Nenhuma alteração pendente
                    </>
                  )}
                </span>
                {dirty && (
                  <button
                    className="text-button"
                    onClick={() => void refresh(true)}
                    disabled={busy}
                  >
                    Descartar alterações
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() => void save()}
                  disabled={!dirty || busy || !draft.baselineName.trim()}
                >
                  <Save size={16} />
                  Salvar configuração
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      <Modal
        title="Adicionar pasta à prévia"
        open={folderDialog}
        close={() => setFolderDialog(false)}
      >
        <p className="modal-copy">
          No aplicativo desktop, esta ação abre o seletor de pastas do sistema.
          Aqui, informe um caminho de exemplo dentro de uma unidade selecionada.
        </p>
        <label className="field-label" htmlFor="folder-path">
          Caminho da pasta de exemplo
        </label>
        <input
          id="folder-path"
          placeholder="/home/usuario/Documentos"
          value={folderPath}
          onChange={(event) => setFolderPath(event.target.value)}
        />
        <div className="modal-actions">
          <button
            className="button secondary"
            onClick={() => setFolderDialog(false)}
          >
            Cancelar
          </button>
          <button
            className="button primary"
            onClick={() => addFolder(folderPath)}
            disabled={!folderPath.trim()}
          >
            <Plus size={16} />
            Adicionar à configuração
          </button>
        </div>
      </Modal>
      <Modal
        title="Escolher o local de instalação"
        open={installDialog}
        close={() => setInstallDialog(false)}
      >
        <div className="modal-information">
          <HardDrive size={24} />
          <div>
            <h3>Windows 10 e 11</h3>
            <p>
              O instalador do aplicativo permite escolher a pasta de destino e
              outra unidade. A mudança de local é feita na instalação, não
              movendo o programa enquanto está aberto.
            </p>
          </div>
        </div>
        <div className="modal-information">
          <FolderOpen size={24} />
          <div>
            <h3>Ubuntu e Debian</h3>
            <p>
              O pacote portátil pode ser extraído na pasta ou no disco desejado.
              Execute-o por esse local. A proteção do sistema continuará
              dependendo do componente Linux.
            </p>
          </div>
        </div>
        <div className="panel-footer">
          <TriangleAlert size={16} />
          <span>
            Os pacotes atuais contêm a interface. Não incluem um mecanismo capaz
            de congelar a máquina.
          </span>
        </div>
        <div className="modal-actions">
          <button
            className="button primary"
            onClick={() => setInstallDialog(false)}
          >
            Entendi
          </button>
        </div>
      </Modal>
      <Modal
        title="Sobre e compatibilidade"
        open={helpDialog}
        close={() => setHelpDialog(false)}
      >
        <div className="about-logo">
          <Snowflake size={36} />
          <strong>RestoreWin</strong>
          <span>{snapshot?.appVersion ?? "0.2.0"} · desenvolvimento</span>
        </div>
        <p className="modal-copy">
          Uma implementação própria para restaurar a instalação física do
          sistema a uma base definida, com manutenção e pastas permanentes.
        </p>
        <div className="compatibility-table">
          <div>
            <strong>Windows 10 e 11</strong>
            <span>Interface preparada; congelamento não implementado.</span>
          </div>
          <div>
            <strong>Ubuntu e Debian</strong>
            <span>Primeiros alvos Linux; congelamento não implementado.</span>
          </div>
          <div>
            <strong>Outras versões e distribuições</strong>
            <span>Sem validação de compatibilidade.</span>
          </div>
        </div>
        <p className="modal-copy">
          A base C experimental foi testada somente com imagens e arquivos
          temporários no Linux. A proteção real exige integração, testes de
          inicialização e recuperação em cada plataforma.
        </p>
        <div className="modal-actions">
          <button
            className="button primary"
            onClick={() => setHelpDialog(false)}
          >
            Fechar
          </button>
        </div>
      </Modal>
    </div>
  );
}
