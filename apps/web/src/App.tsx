import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  Clipboard,
  KeyRound,
  Link2,
  LogOut,
  MessageSquare,
  Moon,
  Plug,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import {
  ApiError,
  api,
  type ApiKeySummary,
  type CreatedKey,
  type DeviceLogin,
  type GatewayRequestLog,
} from "./api.js";

declare const __MYTOKEN_VERSION__: string;

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
  const [playgroundKey, setPlaygroundKey] = useState("");
  const navigation = [
    { to: "/", label: "总览", icon: Activity },
    { to: "/codex", label: "Codex 连接", icon: Link2 },
    { to: "/keys", label: "API Keys", icon: KeyRound },
    { to: "/playground", label: "测试聊天", icon: MessageSquare },
    { to: "/requests", label: "请求记录", icon: ScrollText },
    { to: "/integration", label: "接入配置", icon: Plug },
    { to: "/system", label: "系统", icon: Server },
  ];
  return (
    <div className="min-h-screen bg-[var(--bg)] text-slate-100">
      <div className="fixed right-5 top-5 z-40">
        <ThemeToggle />
      </div>
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
          <Route path="/keys" element={<KeysPage onUseKey={(key) => setPlaygroundKey(key)} />} />
          <Route
            path="/playground"
            element={<PlaygroundPage apiKey={playgroundKey} setApiKey={setPlaygroundKey} />}
          />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/integration" element={<IntegrationPage />} />
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
  const totalRequests =
    keys.data?.data.reduce((sum, key) => sum + key.usage.billableRequests, 0) ?? 0;
  const totalTokens = keys.data?.data.reduce((sum, key) => sum + key.usage.totalTokens, 0) ?? 0;
  return (
    <Page title="网关总览" subtitle="服务器本地 Codex 与个人访问策略">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Gateway"
          value={codex.isError || keys.isError ? "需要检查" : "运行中"}
          good={!codex.isError && !keys.isError}
        />
        <Stat
          label="Codex"
          value={codex.data?.account.connected ? "Connected" : "Auth required"}
          good={Boolean(codex.data?.account.connected)}
        />
        <Stat label="累计请求" value={formatNumber(totalRequests)} good />
        <Stat label="网关记录 Token" value={formatNumber(totalTokens)} good />
        <Stat
          label="Codex 累计 Token"
          value={formatOptionalNumber(codex.data?.usage.summary?.lifetimeTokens)}
          good={Boolean(codex.data?.usage.available)}
        />
        <Stat
          label="Active Keys"
          value={String(keys.data?.data.filter((key) => key.revokedAt === null).length ?? 0)}
          good
        />
      </div>
      <Panel title="使用边界">
        <p className="text-sm leading-6 text-slate-300">
          MyToken 是个人私有预览网关，不是 OpenAI 官方 API。Key 可供支持自定义 OpenAI Responses
          地址的受信任客户端使用。网关会在本机数据库记录请求、IP、上下文和响应， Codex Thread
          使用临时模式，不进入日常 Codex 会话列表。
        </p>
      </Panel>
    </Page>
  );
}

function CodexPage(): ReactNode {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [error, setError] = useState("");
  const status = useQuery({ queryKey: ["codex"], queryFn: api.codex, refetchInterval: 2_000 });
  const start = useMutation({
    mutationFn: api.startCodexLogin,
    onSuccess: (value) => {
      setError("");
      setLogin(value);
    },
    onError: (value) => setError(messageOf(value)),
  });
  const cancel = useMutation({
    mutationFn: api.cancelCodexLogin,
    onSuccess: () => setLogin(null),
    onError: (value) => setError(messageOf(value)),
  });
  const disconnect = useMutation({
    mutationFn: api.logoutCodex,
    onSuccess: async () => {
      setLogin(null);
      await queryClient.invalidateQueries({ queryKey: ["codex"] });
    },
    onError: (value) => setError(messageOf(value)),
  });
  const account = status.data?.account;
  useEffect(() => {
    if (account?.connected) setLogin(null);
  }, [account?.connected]);

  function confirmDisconnect(): void {
    if (window.confirm("确认退出服务器专用 Codex 账号？退出后所有网关 Key 都会暂时无法调用。")) {
      disconnect.mutate();
    }
  }

  return (
    <Page title="Codex 连接" subtitle="先检测服务器专用 Codex 登录；只有未登录时才显示登录入口">
      <Panel title="账户状态" action={<RefreshButton onClick={() => status.refetch()} />}>
        {status.isPending && <p className="mb-4 text-sm text-slate-400">正在检测现有登录…</p>}
        {status.isError && <FormError message={`检测失败：${messageOf(status.error)}`} />}
        <dl className="detail-grid">
          <Detail
            label="状态"
            value={status.isError ? "Worker 不可用" : account?.connected ? "已连接" : "未连接"}
          />
          <Detail label="认证方式" value={account?.authMode ?? "—"} />
          <Detail label="套餐" value={account?.planType ?? "—"} />
          <Detail label="账户" value={account?.emailMasked ?? "—"} />
        </dl>
        <FormError message={error} />
        <div className="mt-6 flex gap-3">
          {!status.isPending && !status.isError && !account?.connected ? (
            <Button loading={start.isPending} onClick={() => start.mutate()}>
              当前未登录，开始登录
            </Button>
          ) : account?.connected ? (
            <Button danger loading={disconnect.isPending} onClick={confirmDisconnect}>
              退出 Codex
            </Button>
          ) : null}
        </div>
      </Panel>
      {login && !account?.connected && (
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
      <Panel title="Codex 额度窗口">
        {status.data?.rateLimits.available ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(status.data.rateLimits.byLimitId).map(([id, bucket]) => (
              <div key={id} className="rounded-xl border border-white/8 p-4">
                <p className="font-medium">{bucket?.limitName ?? bucket?.limitId ?? id}</p>
                <p className="mt-2 text-2xl font-semibold">
                  {formatPercent(bucket?.primary?.usedPercent)} 已使用
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {bucket?.primary?.windowDurationMins ?? "—"} 分钟窗口 · 重置于{" "}
                  {formatTime(bucket?.primary?.resetsAt, true)}
                </p>
              </div>
            ))}
            {Object.keys(status.data.rateLimits.byLimitId).length === 0 && (
              <Detail
                label="主要窗口"
                value={`${formatPercent(status.data.rateLimits.primary?.usedPercent)} 已使用`}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">当前账号没有返回可展示的额度窗口。</p>
        )}
      </Panel>
      <Panel title="Codex 账户用量">
        <dl className="detail-grid">
          <Detail
            label="累计 Token"
            value={formatOptionalNumber(status.data?.usage.summary?.lifetimeTokens)}
          />
          <Detail
            label="单日峰值"
            value={formatOptionalNumber(status.data?.usage.summary?.peakDailyTokens)}
          />
          <Detail
            label="当前连续使用天数"
            value={formatOptionalNumber(status.data?.usage.summary?.currentStreakDays)}
          />
          <Detail
            label="最长 Turn"
            value={
              status.data?.usage.summary?.longestRunningTurnSec == null
                ? "—"
                : `${status.data.usage.summary.longestRunningTurnSec} 秒`
            }
          />
        </dl>
      </Panel>
    </Page>
  );
}

function KeysPage({ onUseKey }: { onUseKey: (key: string) => void }): ReactNode {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.keys });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [error, setError] = useState("");
  const create = useMutation({
    mutationFn: api.createKey,
    onSuccess: async (key) => {
      setError("");
      setCreated(key);
      onUseKey(key.key);
      await queryClient.invalidateQueries({ queryKey: ["keys"] });
    },
    onError: (value) => setError(messageOf(value)),
  });
  const revoke = useMutation({
    mutationFn: api.revokeKey,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
    onError: (value) => setError(messageOf(value)),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ipAllowlist = formString(data, "ipAllowlist")
      .split(/[\s,]+/u)
      .map((value) => value.trim())
      .filter(Boolean);
    create.mutate({
      mode: formString(data, "mode") === "test" ? "test" : "live",
      name: formString(data, "name"),
      allowedModels: data
        .getAll("allowedModels")
        .flatMap((value) => (typeof value === "string" ? [value] : [])),
      allowClientTools: data.get("allowClientTools") === "on",
      rpmLimit: formNumber(data, "rpmLimit", 10),
      dailyRequestLimit: formNumber(data, "dailyRequestLimit", 100),
      maxConcurrency: formNumber(data, "maxConcurrency", 1),
      ipAllowlist,
      requestBudget: formNullableNumber(data, "requestBudget"),
      tokenBudget: formNullableNumber(data, "tokenBudget"),
    });
  }
  return (
    <Page title="API Keys" subtitle="按用途创建 Key，并独立限制模型、IP、速率、并发和总余额">
      <Panel title="创建 Key">
        <form className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
          <Field name="name" label="名称" placeholder="例如：家中电脑、自动化任务" />
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">环境</span>
            <select className="input" name="mode" defaultValue="live">
              <option value="live">Live</option>
              <option value="test">Test</option>
            </select>
          </label>
          <Field name="rpmLimit" label="每分钟请求上限" type="number" min="1" defaultValue="10" />
          <Field
            name="dailyRequestLimit"
            label="每日请求上限"
            type="number"
            min="1"
            defaultValue="100"
          />
          <Field
            name="maxConcurrency"
            label="最大并发"
            type="number"
            min="1"
            max="32"
            defaultValue="1"
          />
          <Field
            name="requestBudget"
            label="总请求额度（留空为不限）"
            type="number"
            min="1"
            required={false}
          />
          <Field
            name="tokenBudget"
            label="总 Token 预算（留空为不限）"
            type="number"
            min="1"
            required={false}
          />
          <label className="block text-sm text-slate-300 lg:col-span-2">
            <span className="mb-2 block">允许的 IP / CIDR（逗号或换行分隔，留空为不限）</span>
            <textarea
              className="input min-h-24"
              name="ipAllowlist"
              placeholder="203.0.113.8, 2001:db8::/48"
            />
          </label>
          <div className="md:col-span-2 lg:col-span-3">
            <p className="mb-3 text-sm text-slate-300">允许的模型</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {models.data?.data.map((model) => (
                <label
                  key={model.id}
                  className="flex gap-2 rounded-lg border border-white/8 p-3 text-sm"
                >
                  <input name="allowedModels" type="checkbox" value={model.id} />
                  <span>
                    {model.providerName ?? model.providerId ?? "Codex"} · {model.displayName}
                    <code className="block text-xs text-slate-500">{model.id}</code>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">未选择模型表示允许当前目录中的全部模型。</p>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-white/8 p-4 text-sm text-slate-300 md:col-span-2 lg:col-span-3">
            <input name="allowClientTools" type="checkbox" />
            允许调用方提交并执行 Responses function tools
            <span className="text-xs text-amber-200">仅为确实需要函数调用的受信任客户端开启</span>
          </label>
          <FormError message={error} />
          <div className="md:col-span-2 lg:col-span-3">
            <Button loading={create.isPending}>创建 Key</Button>
          </div>
        </form>
      </Panel>
      <Panel title="现有 Keys 与使用量">
        <div className="space-y-3">
          {keys.data?.data.map((key) => (
            <div key={key.id} className="rounded-xl border border-white/8 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{key.name}</p>
                  <code className="text-xs text-slate-400">{key.prefix}</code>
                </div>
                {key.revokedAt === null ? (
                  <button
                    className="text-sm text-red-300 hover:text-red-200"
                    onClick={() => {
                      if (window.confirm(`确认撤销 Key“${key.name}”？撤销后不可恢复。`)) {
                        revoke.mutate(key.id);
                      }
                    }}
                  >
                    撤销
                  </button>
                ) : (
                  <span className="text-sm text-slate-500">已撤销</span>
                )}
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="累计请求" value={formatNumber(key.usage.billableRequests)} />
                <Detail
                  label="今日请求"
                  value={`${key.usage.todayRequests} / ${key.dailyRequestLimit}`}
                />
                <Detail label="请求余额" value={formatOptionalNumber(key.requestBalance)} />
                <Detail label="累计 Token" value={formatNumber(key.usage.totalTokens)} />
                <Detail label="Token 余额" value={formatOptionalNumber(key.tokenBalance)} />
                <Detail label="当前并发" value={`${key.activeRequests} / ${key.maxConcurrency}`} />
                <Detail
                  label="模型"
                  value={
                    key.allowedModels.length > 0 ? key.allowedModels.join(", ") : "全部当前模型"
                  }
                />
                <Detail
                  label="IP 限制"
                  value={key.ipAllowlist.length > 0 ? key.ipAllowlist.join(", ") : "不限"}
                />
              </dl>
              <div className="mt-3 text-xs text-slate-500">
                {key.allowClientTools ? "已允许调用方函数工具" : "仅文本与普通 Responses 调用"} ·
                RPM {key.rpmLimit}
              </div>
              {key.revokedAt === null && <KeyPolicyEditor keyRecord={key} />}
            </div>
          ))}
          {keys.data?.data.length === 0 && <p className="text-sm text-slate-400">尚未创建 Key。</p>}
        </div>
      </Panel>
      {created && (
        <KeyModal
          created={created}
          onUse={() => onUseKey(created.key)}
          onClose={() => setCreated(null)}
        />
      )}
    </Page>
  );
}

function KeyPolicyEditor({ keyRecord }: { keyRecord: ApiKeySummary }): ReactNode {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateKey>[1]) => api.updateKey(keyRecord.id, input),
    onSuccess: async () => {
      setMessage("策略已更新");
      await queryClient.invalidateQueries({ queryKey: ["keys"] });
    },
    onError: (value) => setMessage(messageOf(value)),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update.mutate({
      rpmLimit: formNumber(data, "rpmLimit", keyRecord.rpmLimit),
      dailyRequestLimit: formNumber(data, "dailyRequestLimit", keyRecord.dailyRequestLimit),
      maxConcurrency: formNumber(data, "maxConcurrency", keyRecord.maxConcurrency),
      requestBudget: formNullableNumber(data, "requestBudget"),
      tokenBudget: formNullableNumber(data, "tokenBudget"),
      ipAllowlist: formString(data, "ipAllowlist")
        .split(/[\s,]+/u)
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }
  return (
    <details className="mt-4 border-t border-white/8 pt-3">
      <summary className="cursor-pointer text-sm text-emerald-300">调整限制与余额</summary>
      <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={submit}>
        <Field
          name="rpmLimit"
          label="RPM"
          type="number"
          min="1"
          defaultValue={keyRecord.rpmLimit}
        />
        <Field
          name="dailyRequestLimit"
          label="每日上限"
          type="number"
          min="1"
          defaultValue={keyRecord.dailyRequestLimit}
        />
        <Field
          name="maxConcurrency"
          label="最大并发"
          type="number"
          min="1"
          max="32"
          defaultValue={keyRecord.maxConcurrency}
        />
        <Field
          name="requestBudget"
          label="总请求额度"
          type="number"
          min="1"
          required={false}
          defaultValue={keyRecord.requestBudget ?? ""}
        />
        <Field
          name="tokenBudget"
          label="Token 预算"
          type="number"
          min="1"
          required={false}
          defaultValue={keyRecord.tokenBudget ?? ""}
        />
        <Field
          name="ipAllowlist"
          label="IP / CIDR"
          required={false}
          defaultValue={keyRecord.ipAllowlist.join(", ")}
        />
        <div className="md:col-span-3 flex items-center gap-3">
          <Button loading={update.isPending}>保存策略</Button>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </form>
    </details>
  );
}

function PlaygroundPage({
  apiKey,
  setApiKey,
}: {
  apiKey: string;
  setApiKey: (value: string) => void;
}): ReactNode {
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.testResponse>> | null>(null);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: api.testResponse,
    onSuccess: (value) => {
      setError("");
      setResult(value);
    },
    onError: (value) => setError(messageOf(value)),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      key: apiKey,
      model: formString(data, "model"),
      instructions: formString(data, "instructions"),
      input: formString(data, "input"),
    });
  }
  return (
    <Page title="测试聊天" subtitle="使用选定 Key 发起真实网关调用；Key 只保存在当前页面内存中">
      <Panel title="请求">
        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">MyToken Key</span>
            <input
              className="input font-mono"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">模型</span>
            <select className="input" name="model" required defaultValue="">
              <option value="" disabled>
                选择模型
              </option>
              {models.data?.data.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.providerName ?? model.providerId ?? "Codex"} · {model.displayName} (
                  {model.id})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">Instructions（可选）</span>
            <textarea className="input min-h-20" name="instructions" />
          </label>
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">消息</span>
            <textarea className="input min-h-32" name="input" required />
          </label>
          <p className="text-xs text-slate-500">
            本次 Codex Thread 使用 ephemeral 模式，不进入 Codex 会话列表；请求
            IP、上下文和响应会记录在网关数据库中。
          </p>
          <FormError message={error} />
          <Button loading={mutation.isPending}>发送测试</Button>
        </form>
      </Panel>
      {result && (
        <Panel title="响应">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {result.output_text || result.error?.message || "没有文本输出"}
          </p>
          <dl className="detail-grid mt-6">
            <Detail label="Response ID" value={result.id} />
            <Detail label="状态" value={result.status} />
            <Detail label="模型" value={result.model} />
            <Detail
              label="Token"
              value={result.usage ? formatNumber(result.usage.total_tokens) : "上游未返回"}
            />
          </dl>
        </Panel>
      )}
    </Page>
  );
}

function RequestsPage(): ReactNode {
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.keys });
  const [keyId, setKeyId] = useState("");
  const requests = useQuery({
    queryKey: ["requests", keyId],
    queryFn: () => api.requests(keyId || undefined),
    refetchInterval: 5_000,
  });
  return (
    <Page title="请求记录" subtitle="查看每个 Key 的调用、来源 IP、错误、Token 和上下文">
      <Panel title="最近请求" action={<RefreshButton onClick={() => requests.refetch()} />}>
        <label className="mb-5 block max-w-sm text-sm text-slate-300">
          <span className="mb-2 block">按 Key 筛选</span>
          <select
            className="input"
            value={keyId}
            onChange={(event) => setKeyId(event.target.value)}
          >
            <option value="">全部 Key</option>
            {keys.data?.data.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name}
              </option>
            ))}
          </select>
        </label>
        {requests.isError && <FormError message={messageOf(requests.error)} />}
        <div className="space-y-3">
          {requests.data?.data.map((entry) => (
            <RequestEntry key={entry.id} entry={entry} />
          ))}
          {requests.data?.data.length === 0 && (
            <p className="text-sm text-slate-400">还没有请求记录。</p>
          )}
        </div>
      </Panel>
    </Page>
  );
}

function RequestEntry({ entry }: { entry: GatewayRequestLog }): ReactNode {
  return (
    <details className="rounded-xl border border-white/8 p-4">
      <summary className="cursor-pointer list-none">
        <div className="grid gap-2 text-sm md:grid-cols-6">
          <span className="font-medium">{entry.keyName}</span>
          <span>
            {entry.model
              ? `${entry.providerId} · ${entry.upstreamModel ?? entry.model}`
              : entry.path}
          </span>
          <span>{entry.sourceIp}</span>
          <span>
            {entry.statusCode ?? "—"} · {entry.status}
          </span>
          <span>{entry.latencyMs == null ? "—" : `${entry.latencyMs} ms`}</span>
          <span>{formatTime(entry.startedAt)}</span>
        </div>
      </summary>
      <dl className="detail-grid my-4">
        <Detail label="Request ID" value={entry.requestId} />
        <Detail label="路径" value={`${entry.method} ${entry.path}`} />
        <Detail label="Token" value={formatOptionalNumber(entry.totalTokens)} />
        <Detail label="错误" value={entry.errorCode ?? "—"} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <JsonBlock title="请求上下文" value={entry.requestBody} />
        <JsonBlock title="响应" value={entry.responseBody} />
      </div>
    </details>
  );
}

function IntegrationPage(): ReactNode {
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const model = models.data?.data[0]?.id ?? "<model-id>";
  const baseUrl = `${window.location.origin}/v1`;
  const codexConfig = `model = "${model}"
model_provider = "mytoken"

[model_providers.mytoken]
name = "MyToken Gateway"
base_url = "${baseUrl}"
env_key = "MYTOKEN_API_KEY"
wire_api = "responses"`;
  return (
    <Page title="接入配置" subtitle="适用于支持自定义 OpenAI Responses 地址的客户端">
      <Panel title="通用参数">
        <dl className="detail-grid">
          <Detail label="Base URL" value={baseUrl} />
          <Detail label="认证" value="Authorization: Bearer <MyToken Key>" />
          <Detail label="Responses" value={`${baseUrl}/responses`} />
          <Detail label="Models" value={`${baseUrl}/models`} />
        </dl>
      </Panel>
      <Panel title="Codex CLI 自定义 Provider">
        <p className="mb-3 text-sm text-slate-300">
          MyToken Key 不是 Codex 官方登录凭据，但可以作为自定义 Responses Provider 的 Bearer Key。
          当前属于兼容预览，请先在“测试聊天”验证所选模型。
        </p>
        <JsonBlock title="~/.codex/config.toml" value={codexConfig} raw />
        <JsonBlock title="终端环境变量" value={`export MYTOKEN_API_KEY="myt_..."`} raw />
      </Panel>
      <Panel title="其他客户端">
        <p className="text-sm leading-6 text-slate-300">
          在 OpenAI-compatible / Responses Provider 设置中填写相同 Base URL、Key 和模型 ID。
          只有需要客户端函数调用时，才为该 Key 开启“调用方函数工具”。
        </p>
      </Panel>
    </Page>
  );
}

function SystemPage(): ReactNode {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready });
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const update = useQuery({
    queryKey: ["system-update"],
    queryFn: api.systemUpdate,
    refetchInterval: 5_000,
    retry: false,
  });
  const startUpdate = useMutation({
    mutationFn: api.startSystemUpdate,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["system-update"] }),
  });
  const updateRunning =
    update.data?.status.status === "running" || update.data?.status.status === "pending";
  const updateAvailable = isNewerVersion(update.data?.latest.version, update.data?.currentVersion);
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
      <Panel title="模型 Providers">
        <div className="grid gap-3 md:grid-cols-2">
          {providers.data?.data.map((provider) => (
            <div key={provider.id} className="rounded-xl border border-white/8 p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{provider.name}</p>
                <span className={provider.ready ? "text-emerald-300" : "text-amber-300"}>
                  {provider.ready ? "Ready" : provider.enabled ? "Unavailable" : "未配置"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {provider.id} · {provider.protocol} · {provider.modelsCount} models
              </p>
              {provider.error && <p className="mt-2 text-xs text-red-300">{provider.error}</p>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="系统更新" action={<RefreshButton onClick={() => update.refetch()} />}>
        {update.isError ? (
          <p className="text-sm text-slate-400">当前部署未启用页面更新服务，可继续使用终端更新。</p>
        ) : (
          <>
            <dl className="detail-grid">
              <Detail label="当前版本" value={update.data?.currentVersion ?? "—"} />
              <Detail label="Preview 最新版" value={update.data?.latest.version ?? "检查中"} />
              <Detail label="更新状态" value={update.data?.status.status ?? "idle"} />
              <Detail label="目标版本" value={update.data?.status.version ?? "—"} />
            </dl>
            {update.data?.status.message && (
              <p className="mt-4 text-sm text-slate-400">{update.data.status.message}</p>
            )}
            {startUpdate.isError && <FormError message={messageOf(startUpdate.error)} />}
            <div className="mt-5">
              <Button
                loading={startUpdate.isPending || updateRunning}
                onClick={() => {
                  if (
                    window.confirm(
                      `确认更新到 ${update.data?.latest.version ?? "preview 最新版"}？更新期间 API 和 Codex Worker 会短暂重启，失败时会自动恢复旧运行版本。`,
                    )
                  ) {
                    startUpdate.mutate();
                  }
                }}
              >
                {updateRunning
                  ? "正在更新"
                  : updateAvailable
                    ? "更新到最新版"
                    : "重新安装当前最新版"}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </Page>
  );
}

function KeyModal({
  created,
  onUse,
  onClose,
}: {
  created: CreatedKey;
  onUse: () => void;
  onClose: () => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(created.key);
    setCopied(true);
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="created-key-title"
        className="w-full max-w-2xl rounded-2xl border border-emerald-400/20 bg-[var(--surface)] p-6 shadow-2xl"
      >
        <h2 id="created-key-title" className="text-xl font-semibold">
          保存你的 Key
        </h2>
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
          <button
            className="button-secondary"
            onClick={() => {
              onUse();
              onClose();
            }}
          >
            用于测试聊天
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
      <div className="fixed right-5 top-5 z-40">
        <ThemeToggle />
      </div>
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

type Theme = "light" | "dark";

function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("mytoken.theme", theme);
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
  }, [theme]);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="button-secondary h-10 w-10 p-0 shadow-sm"
      aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
      title={dark ? "浅色模式" : "深色模式"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function currentTheme(): Theme {
  if (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark") {
    return "dark";
  }
  try {
    return localStorage.getItem("mytoken.theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function Brand(): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-300 to-blue-500 font-black text-slate-950">
        M
      </div>
      <div>
        <p className="font-semibold tracking-wide">MyToken</p>
        <p className="text-xs text-slate-500">Gateway · {__MYTOKEN_VERSION__}</p>
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
      aria-label="刷新"
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
    <div
      role="status"
      className="grid min-h-screen place-items-center bg-[var(--bg)] text-slate-300"
    >
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
  return message ? (
    <p role="alert" className="text-sm text-red-300">
      {message}
    </p>
  ) : null;
}

function JsonBlock({
  title,
  value,
  raw = false,
}: {
  title: string;
  value: unknown;
  raw?: boolean;
}): ReactNode {
  const text = raw && typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">{title}</p>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/30 p-4 text-xs text-slate-300">
        {text ?? "null"}
      </pre>
    </div>
  );
}

function messageOf(value: unknown): string {
  return value instanceof ApiError || value instanceof Error ? value.message : "请求失败";
}

function formString(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function formNumber(data: FormData, name: string, fallback: number): number {
  const value = Number(formString(data, name));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function formNullableNumber(data: FormData, name: string): number | null {
  const raw = formString(data, name).trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value == null ? "不限 / 未提供" : formatNumber(value);
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 10) / 10}%`;
}

function formatTime(value: number | null | undefined, seconds = false): string {
  if (value == null) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(seconds ? value * 1000 : value));
}

function isNewerVersion(latest: string | undefined, current: string | null | undefined): boolean {
  if (!latest || !current) return false;
  const parse = (value: string): number[] =>
    value
      .replace(/^v/u, "")
      .split(/[.-]/u)
      .map((part) => Number(part))
      .filter((part) => Number.isFinite(part));
  const left = parse(latest);
  const right = parse(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}
