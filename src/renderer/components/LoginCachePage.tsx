import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatLocalCacheText, parseLocalCacheText } from "../../shared/local-cache";
import {
  LOGIN_CACHE_CATEGORIES,
  LOGIN_CACHE_CATEGORY_LABELS,
  filterLoginCacheFields,
  loginCacheCustomerSummary,
  loginCacheFields,
  loginCacheSummary,
  type LoginCacheField,
  type LoginCacheFilter,
} from "../login-cache-data";
import { useToast } from "./ToastProvider";

interface LoginCachePageProps {
  instanceId?: string;
  instanceName?: string;
  running?: boolean;
  values: Record<string, string>;
  onSave: (values: Record<string, string>) => Promise<boolean>;
}

type LoginCacheViewMode = "visual" | "text";

const FILTERS: Array<{ id: LoginCacheFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "credential", label: "凭证" },
  { id: "account", label: "账户" },
  { id: "risk", label: "风险" },
  { id: "sensitive", label: "敏感" },
  { id: "long", label: "超长" },
];

function LoginCacheCategoryBadge({ entry }: { entry: LoginCacheField }) {
  return <span className={`login-cache-category ${entry.category}`}><i />{entry.categoryLabel}</span>;
}

function LoginCacheStatus({ summary }: { summary: ReturnType<typeof loginCacheSummary> }) {
  const state = summary.tokenPresent && summary.sessionPresent ? "ready" : summary.tokenPresent || summary.sessionPresent ? "partial" : "waiting";
  const title = state === "ready" ? "登录态已就绪" : state === "partial" ? "登录态不完整" : "等待登录";
  const subtitle = state === "ready"
    ? "Token 与 SessionNo 均已缓存，可直接参与请求变量替换。"
    : state === "partial"
      ? "已捕获部分登录信息，建议完成一次成功登录以补齐关键字段。"
      : "尚未捕获到登录凭证，请完成一次成功登录。";
  const badge = state === "ready" ? "READY" : state === "partial" ? "PARTIAL" : "WAITING";
  return { state, title, subtitle, badge };
}

export function LoginCachePage({ instanceId, instanceName, running = false, values, onSave }: LoginCachePageProps) {
  const { notify, notifyError } = useToast();
  const fields = useMemo(() => loginCacheFields(values), [values]);
  const summary = useMemo(() => loginCacheSummary(values), [values]);
  const status = useMemo(() => LoginCacheStatus({ summary }), [summary]);
  const [viewMode, setViewMode] = useState<LoginCacheViewMode>("visual");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LoginCacheFilter>("all");
  const [text, setText] = useState(() => formatLocalCacheText(values));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const instanceIdRef = useRef(instanceId);

  const filteredFields = useMemo(() => filterLoginCacheFields(fields, query, filter), [fields, query, filter]);
  const customer = useMemo(() => loginCacheCustomerSummary(values), [values]);
  const currentInstance = instanceName ?? "当前代理";
  const statusText = busy ? "保存中…" : dirty ? "待保存" : "已同步";
  const statusTone = busy ? "saving" : dirty ? "dirty" : "ready";

  useEffect(() => {
    instanceIdRef.current = instanceId;
    setViewMode("visual");
    setQuery("");
    setFilter("all");
    setDirty(false);
    dirtyRef.current = false;
    busyRef.current = false;
    setBusy(false);
  }, [instanceId]);

  useEffect(() => {
    if (viewMode === "visual" || !dirtyRef.current) setText(formatLocalCacheText(values));
  }, [values, viewMode]);

  const saveText = async (): Promise<boolean> => {
    if (busyRef.current) return false;
    let parsed: Record<string, string>;
    try {
      parsed = parseLocalCacheText(text);
    } catch (cause) {
      notifyError(cause, "登录缓存格式无效");
      return false;
    }
    const targetInstanceId = instanceIdRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const saved = await onSave(parsed);
      if (!saved || instanceIdRef.current !== targetInstanceId) return false;
      dirtyRef.current = false;
      setDirty(false);
      setText(formatLocalCacheText(parsed));
      notify({ kind: "success", message: "登录缓存已保存" });
      return true;
    } catch (cause) {
      notifyError(cause, "登录缓存保存失败");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const toggleViewMode = async () => {
    if (busyRef.current) return;
    if (viewMode === "visual") {
      setText(formatLocalCacheText(values));
      setDirty(false);
      dirtyRef.current = false;
      setViewMode("text");
      return;
    }
    if (dirtyRef.current && !(await saveText())) return;
    setViewMode("visual");
  };

  return <section className="login-cache-page">
    <div className="login-cache-heading">
      <div className="login-cache-heading-copy">
        <p className="eyebrow">SESSION CACHE</p>
        <div className="login-cache-title-row"><h2>登录缓存</h2><span className={`login-cache-status ${statusTone}`} aria-live="polite"><i />{statusText}</span></div>
        <p className="login-cache-description">当前代理最近一次成功登录后的字段快照。所有字段均按明文完整展示，仅写入 <code>ErrorNo &gt; 0</code> 的成功响应。</p>
        <div className="login-cache-instance"><span>当前代理</span><strong>{currentInstance}</strong><em className={running ? "running" : "stopped"}>{running ? "运行中" : "已停止"}</em></div>
      </div>
      <div className="login-cache-heading-actions">
        {viewMode === "text" && <button type="button" className="login-cache-button primary" disabled={busy || !dirty} onClick={() => void saveText()}>保存文本</button>}
        <button type="button" className="login-cache-button" disabled={busy} onClick={() => void toggleViewMode()}>{viewMode === "visual" ? "原始文本" : "可视化视图"}</button>
      </div>
    </div>

    {viewMode === "visual" ? <div className="login-cache-visual">
      <div className="login-cache-hero-grid">
        <section className="login-cache-panel login-cache-customer-card" aria-label="当前登录客户">
          <div className="login-cache-customer-top">
            <div className="login-cache-customer-avatar">{customer.initial}</div>
            <div className="login-cache-customer-copy">
              <div className="login-cache-customer-name-line">
                <h3>{customer.hasCustomer ? customer.name : "尚未缓存身份"}</h3>
                <span className={`login-cache-ready-badge ${status.state}`}><i />{status.title}</span>
              </div>
              <div className="login-cache-customer-subline"><span>客户号</span><code>{customer.code}</code><i /><span>最近登录</span><b>{customer.lastLogin}</b></div>
            </div>
          </div>
          <div className="login-cache-customer-details">
            <div><span>客户类型</span><strong>{customer.type}</strong></div>
            <div><span>开户网点</span><strong>{customer.branch}</strong></div>
            <div><span>开户日期</span><strong>{customer.openDate}</strong></div>
            <div><span>证件号码</span><strong>{customer.certificate}</strong></div>
            <div><span>手机号</span><strong>{customer.phone}</strong></div>
            <div><span>账户数量</span><strong>{customer.accountCount > 0 ? `${customer.accountCount} 个` : "—"}</strong></div>
          </div>
          <div className="login-cache-customer-accounts">
            <span>账户</span>
            <div className="login-cache-account-chips">
              {customer.accounts.length > 0
                ? customer.accounts.map((account) => <span key={`${account.type}-${account.number}`}><i />{account.label}</span>)
                : <em>未缓存账户信息</em>}
            </div>
          </div>
        </section>
      </div>

      <div className="login-cache-insight-grid">
        <section className="login-cache-panel login-cache-composition-card">
          <div className="login-cache-section-heading"><div><h3>缓存构成</h3><p>按字段语义分组，快速判断登录数据完整度</p></div><span>{summary.total} 项字段</span></div>
          <div className="login-cache-composition-bar">{LOGIN_CACHE_CATEGORIES.filter((category) => summary.categories[category] > 0).map((category) => <span key={category} className={category} style={{ flex: summary.categories[category] }} />)}</div>
          <div className="login-cache-composition-legend">{LOGIN_CACHE_CATEGORIES.map((category) => <span key={category} className={category}><i />{LOGIN_CACHE_CATEGORY_LABELS[category]} <b>{summary.categories[category]}</b></span>)}</div>
        </section>
        <section className="login-cache-panel login-cache-health-card">
          <div className="login-cache-health-donut" style={{ "--login-cache-health": `${summary.healthPercent}%` } as CSSProperties}><strong>{summary.healthPercent}%</strong></div>
          <div><h3>数据健康度</h3><p>有值字段占比。空值、敏感字段与超长字段可单独筛选。</p><div className="login-cache-health-stats"><span>非空 <b>{summary.nonEmpty}</b></span><span>空值 <b>{summary.empty}</b></span><span>敏感 <b>{summary.sensitive}</b></span><span>超长 <b>{summary.long}</b></span></div></div>
        </section>
      </div>

      <div className="login-cache-workspace">
        <section className="login-cache-panel login-cache-list-panel">
          <div className="login-cache-list-heading">
            <div><h3>字段明细</h3><p>搜索和筛选登录缓存字段，右侧页面整体滚动查看全部内容</p></div>
            <div className="login-cache-list-heading-meta"><span className="login-cache-scroll-hint">↕ 页面整体滚动</span><span>{filteredFields.length} / {fields.length}</span></div>
          </div>
          <div className="login-cache-toolbar">
            <label className="login-cache-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索键名或值" aria-label="搜索登录缓存" /></label>
            <div className="login-cache-filters" aria-label="登录缓存筛选">{FILTERS.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
          </div>
          <div className="login-cache-field-list" role="list" aria-label="登录缓存字段">
            {filteredFields.map((entry) => <div role="listitem" key={entry.key} className="login-cache-field-row"><span className="login-cache-field-key">{entry.key}</span><LoginCacheCategoryBadge entry={entry} /><span className={`login-cache-field-preview ${entry.chars === 0 ? "empty" : ""}`} title={entry.value}>{entry.preview}</span><span className="login-cache-field-size">{entry.chars}</span></div>)}
            {filteredFields.length === 0 && <div className="login-cache-list-empty">{fields.length === 0 ? "暂无登录缓存，完成一次成功登录后会自动写入。" : "没有匹配的字段"}</div>}
          </div>
        </section>
      </div>
      <p className="login-cache-footnote">这些字段会与共享变量合并，并用于转发请求中的 <code>($KEY)</code> 变量替换。</p>
    </div> : <section className="login-cache-text-panel">
      <div className="login-cache-text-heading"><div><h3>原始文本模式</h3><p>保留完整 <code>key = value</code> 文本，便于批量粘贴和检查。离开输入框后自动保存。</p></div><span>{text.length.toLocaleString("zh-CN")} 字符</span></div>
      <textarea className="config-textarea login-cache-input" aria-label="登录缓存" value={text} onChange={(event) => { setText(event.target.value); setDirty(true); dirtyRef.current = true; }} onBlur={() => { if (dirtyRef.current) void saveText(); }} rows={14} placeholder="Token = xxx\nSessionNo = 123" spellCheck={false} />
    </section>}
  </section>;
}
