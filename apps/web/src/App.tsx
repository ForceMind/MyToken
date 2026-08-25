import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  Clipboard,
  KeyRound,
  Link2,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { ApiError, api, type CreatedKey, type DeviceLogin } from "./api.js";

export function App(): ReactNode {
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus });
  if (setup.isPending) return <Loading label="检查服务器状态" />;
  if (setup.isError) return <Fatal error={setup.error} />;
  if (!setup.data.initialized) return <SetupPage />;
  return <SessionGate />;
}

function SessionGate(): ReactNode {
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  if (session.isPending) return <Loading label="验证管理员会话" />;
  if (session.isError) return <LoginPage />;
  return <Console username={session.data.user.username} />;
}

function SetupPage(): ReactNode {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: api.setup,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["setup"] }),
    onError: (value) => setError(messageOf(value)),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = formString(data, "password");
    if (password !== formString(data, "confirmPassword")) {
      setError("两次输入的密码不一致");
      return;
    }
    mutation.mutate({
      bootstrapToken: formString(data, "bootstrapToken"),
      username: formString(data, "username"),
      password,
    });
  }
  return (
    <AuthShell title="初始化私有网关" subtitle="创建唯一管理员。Bootstrap Token 使用后立即失效。">
      <form className="space-y-4" onSubmit={submit}>
        <Field name="bootstrapToken" label="Bootstrap Token" autoComplete="off" />
        <Field name="username" label="管理员用户名" autoComplete="username" />
        <Field
          name="password"
          label="密码（至少 12 位）"
          type="password"
          autoComplete="new-password"
        />
        <Field
          name="confirmPassword"
          label="确认密码"
          type="password"
          autoComplete="new-password"
        />
        <FormError message={error} />
        <Button loading={mutation.isPending}>完成初始化</Button>
      </form>
    </AuthShell>
  );
}

function LoginPage(): ReactNode {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: api.login,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["session"] }),
    onError: (value) => setError(messageOf(value)),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      username: formString(data, "username"),
      password: formString(data, "password"),
    });
  }
  return (
    <AuthShell title="管理员登录" subtitle="会话只保存在 HttpOnly Cookie 中。">
      <form className="space-y-4" onSubmit={submit}>
        <Field name="username" label="用户名" autoComplete="username" />
        <Field name="password" label="密码" type="password" autoComplete="current-password" />
        <FormError message={error} />
        <Button loading={mutation.isPending}>登录</Button>
      </form>
    </AuthShell>
  );
}

function Console({ username }: { username: string }): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/");
    },
  });
  const location = useLocation();
  const navigation = [
    { to: "/", label: "总览", icon: Activity },
    { to: "/codex", label: "Codex 连接", icon: Link2 },
    { to: "/keys", label: "API Keys", icon: KeyRound },
    { to: "/system", label: "系统", icon: Server },
  ];
  return (
    <div className="min-h-screen bg-[var(--bg)] text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/8 bg-[var(--surface)] p-5 md:block">
        <Brand />
        <nav className="mt-10 space-y-2">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`nav-item ${location.pathname === to ? "nav-item-active" : ""}`}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-5 left-5 right-5 border-t border-white/8 pt-4">
          <p className="mb-3 truncate text-sm text-slate-400">{username}</p>
          <button className="nav-item w-full" onClick={() => logout.mutate()}>
            <LogOut size={18} /> 退出
          </button>
        </div>
      </aside>
      <main className="mx-auto max-w-6xl px-5 py-8 md:ml-64 md:px-10">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/codex" element={<CodexPage />} />
          <Route path="/keys" element={<KeysPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Overview(): ReactNode {
  const codex = useQuery({ queryKey: ["codex"], queryFn: api.codex, refetchInterval: 10_000 });
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.keys });
  return (
    <Page title="网关总览" subtitle="服务器本地 Codex 与个人访问策略">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Gateway" value="Running" good />
        <Stat
          label="Codex"
          value={codex.data?.account.connected ? "Connected" : "Auth required"}
          good={Boolean(codex.data?.account.connected)}
        />
        <Stat
          label="Active Keys"
          value={String(keys.data?.data.filter((key) => key.revokedAt === null).length ?? 0)}
          good
        />
      </div>
      <Panel title="使用边界">
        <p className="text-sm leading-6 text-slate-300">
          MyToken 是个人私有预览网关，不是 OpenAI 官方 API。客户端工具由 OpenClaw
          执行，服务器不会执行客户端 Shell 或文件工具。
        </p>
      </Panel>
    </Page>
  );
}

function CodexPage(): ReactNode {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const status = useQuery({ queryKey: ["codex"], queryFn: api.codex, refetchInterval: 5_000 });
  const start = useMutation({ mutationFn: api.startCodexLogin, onSuccess: setLogin });
  const cancel = useMutation({
    mutationFn: api.cancelCodexLogin,
    onSuccess: () => setLogin(null),
  });
  const disconnect = useMutation({
    mutationFn: api.logoutCodex,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["codex"] }),
  });
  const account = status.data?.account;
  return (
    <Page title="Codex 连接" subtitle="凭据由服务器上的 Codex 管理，永不返回浏览器">
      <Panel title="账户状态" action={<RefreshButton onClick={() => status.refetch()} />}>
        <dl className="detail-grid">
          <Detail label="状态" value={account?.connected ? "已连接" : "未连接"} />
          <Detail label="认证方式" value={account?.authMode ?? "—"} />
          <Detail label="套餐" value={account?.planType ?? "—"} />
          <Detail label="账户" value={account?.emailMasked ?? "—"} />
        </dl>
        <div className="mt-6 flex gap-3">
          {!account?.connected ? (
            <Button loading={start.isPending} onClick={() => start.mutate()}>
              连接 Codex
            </Button>
          ) : (
            <Button danger loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              退出 Codex
            </Button>
          )}
        </div>
      </Panel>
      {login && (
        <Panel title="完成设备码登录">
          <p className="text-sm text-slate-300">只在你主动打开的官方页面输入以下一次性代码。</p>
          <div className="my-5 rounded-xl bg-black/25 p-5 text-center font-mono text-3xl tracking-widest text-emerald-300">
            {login.userCode}
          </div>
          <div className="flex gap-3">
            <a
              className="button-primary inline-flex"
              href={login.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开官方登录页面
            </a>
            <button
              className="button-secondary"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(login.loginId)}
            >
              取消登录
            </button>
          </div>
        </Panel>
      )}
    </Page>
  );
}

function KeysPage(): ReactNode {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.keys });
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const create = useMutation({
    mutationFn: api.createKey,
    onSuccess: async (key) => {
      setCreated(key);
      await queryClient.invalidateQueries({ queryKey: ["keys"] });
    },
  });
  const revoke = useMutation({
    mutationFn: api.revokeKey,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const model = formString(data, "model").trim();
    create.mutate({
      mode: "live",
      name: formString(data, "name") || "OpenClaw",
      allowedModels: model ? [model] : [],
      allowClientTools: data.get("allowClientTools") === "on",
      rpmLimit: 10,
      dailyRequestLimit: 100,
      maxConcurrency: 1,
    });
  }
  return (
    <Page title="API Keys" subtitle="完整 Key 只显示一次，数据库仅保存摘要">
      <Panel title="创建 Key">
        <form className="grid gap-4 md:grid-cols-3" onSubmit={submit}>
          <Field name="name" label="名称" defaultValue="OpenClaw" />
          <Field name="model" label="模型白名单（留空为全部）" placeholder="gpt-..." />
          <label className="flex items-end gap-2 pb-3 text-sm text-slate-300">
            <input name="allowClientTools" type="checkbox" defaultChecked /> 允许 OpenClaw
            客户端工具
          </label>
          <div className="md:col-span-3">
            <Button loading={create.isPending}>创建 Key</Button>
          </div>
        </form>
      </Panel>
      <Panel title="现有 Keys">
        <div className="space-y-3">
          {keys.data?.data.map((key) => (
            <div
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/8 p-4"
            >
              <div>
                <p className="font-medium">{key.name}</p>
                <code className="text-xs text-slate-400">{key.prefix}</code>
              </div>
              <div className="text-xs text-slate-400">
                {key.allowClientTools ? "Tools enabled" : "Text only"}
              </div>
              {key.revokedAt === null ? (
                <button
                  className="text-sm text-red-300 hover:text-red-200"
                  onClick={() => revoke.mutate(key.id)}
                >
                  撤销
                </button>
              ) : (
                <span className="text-sm text-slate-500">已撤销</span>
              )}
            </div>
          ))}
          {keys.data?.data.length === 0 && <p className="text-sm text-slate-400">尚未创建 Key。</p>}
        </div>
      </Panel>
      {created && <KeyModal created={created} onClose={() => setCreated(null)} />}
    </Page>
  );
}

function SystemPage(): ReactNode {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready });
  return (
    <Page title="系统" subtitle="非敏感运行状态">
      <Panel title="服务状态">
        <dl className="detail-grid">
          <Detail label="API" value={health.data?.status ?? "unknown"} />
          <Detail label="Gateway" value={ready.data?.status ?? "not ready"} />
          <Detail label="部署模式" value="single-server private preview" />
          <Detail label="协议" value="OpenAI Responses subset" />
        </dl>
      </Panel>
    </Page>
  );
}

function KeyModal({ created, onClose }: { created: CreatedKey; onClose: () => void }): ReactNode {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(created.key);
    setCopied(true);
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5">
      <div className="w-full max-w-2xl rounded-2xl border border-emerald-400/20 bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="text-xl font-semibold">保存你的 Key</h2>
        <p className="mt-2 text-sm text-amber-200">关闭后无法再次查看完整 Key。</p>
        <code className="my-5 block break-all rounded-xl bg-black/30 p-4 text-sm text-emerald-300">
          {created.key}
        </code>
        <div className="flex gap-3">
          <button className="button-primary" onClick={() => void copy()}>
            {copied ? <Check size={17} /> : <Clipboard size={17} />} {copied ? "已复制" : "复制"}
          </button>
          <button className="button-secondary" onClick={onClose}>
            我已保存
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--bg)] p-5 text-slate-100">
      <div className="w-full max-w-md">
        <Brand />
        <div className="mt-8 rounded-2xl border border-white/8 bg-[var(--surface)] p-7 shadow-2xl">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mb-6 mt-2 text-sm text-slate-400">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function Brand(): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-300 to-blue-500 font-black text-slate-950">
        M
      </div>
      <div>
        <p className="font-semibold tracking-wide">MyToken</p>
        <p className="text-xs text-slate-500">Personal Codex Gateway</p>
      </div>
    </div>
  );
}

function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-slate-400">{subtitle}</p>
      </header>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="rounded-2xl border border-white/8 bg-[var(--surface)] p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field(props: InputHTMLAttributes<HTMLInputElement> & { label: string }): ReactNode {
  const { label, ...inputProps } = props;
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input required className="input" {...inputProps} />
    </label>
  );
}

function Button({
  children,
  loading,
  danger,
  onClick,
}: {
  children: ReactNode;
  loading?: boolean;
  danger?: boolean;
  onClick?: () => void;
}): ReactNode {
  return (
    <button
      type={onClick ? "button" : "submit"}
      className={danger ? "button-danger" : "button-primary"}
      disabled={loading}
      onClick={onClick}
    >
      {loading && <RefreshCw size={17} className="animate-spin" />}
      {children}
    </button>
  );
}

function RefreshButton({ onClick }: { onClick: () => unknown }): ReactNode {
  return (
    <button
      className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
      onClick={() => void onClick()}
    >
      <RefreshCw size={17} />
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }): ReactNode {
  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        {good ? (
          <ShieldCheck size={18} className="text-emerald-300" />
        ) : (
          <Server size={18} className="text-amber-300" />
        )}
      </div>
      <p className="mt-5 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Loading({ label }: { label: string }): ReactNode {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--bg)] text-slate-300">
      <div className="flex items-center gap-3">
        <RefreshCw className="animate-spin" /> {label}
      </div>
    </div>
  );
}

function Fatal({ error }: { error: unknown }): ReactNode {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--bg)] p-6 text-slate-100">
      <div className="max-w-lg rounded-2xl border border-red-400/20 bg-[var(--surface)] p-6">
        <h1 className="text-xl font-semibold">无法连接 MyToken</h1>
        <p className="mt-3 text-sm text-red-200">{messageOf(error)}</p>
      </div>
    </div>
  );
}

function FormError({ message }: { message: string }): ReactNode {
  return message ? <p className="text-sm text-red-300">{message}</p> : null;
}

function messageOf(value: unknown): string {
  return value instanceof ApiError || value instanceof Error ? value.message : "请求失败";
}

function formString(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
