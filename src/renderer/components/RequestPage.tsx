import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppConfig, ManualRequestConfig, ManualRequestResponse } from "../../shared/contracts";
import { DEFAULT_REQUEST_HOST, DEFAULT_REQUEST_PARAMS_TEXT, DEFAULT_REQUEST_PORT } from "../../shared/config-defaults";
import { parseManualRequestParams, parseManualRequestPort } from "../../shared/manual-request";
import { useToast } from "./ToastProvider";
import { WorkspaceIcon } from "./WorkspaceChrome";

interface RequestPageProps {
  config: AppConfig;
  active?: boolean;
  onChange: (config: AppConfig) => Promise<boolean>;
  onSendRequest: (request: ManualRequestConfig) => Promise<ManualRequestResponse>;
  onFillJson: (text: string) => void;
  onOpenSession?: () => void;
}

type RequestView = "params" | "raw" | "form";
type ResponseView = "json" | "table" | "raw";

const defaultRequest: ManualRequestConfig = { host: DEFAULT_REQUEST_HOST, port: DEFAULT_REQUEST_PORT, paramsText: DEFAULT_REQUEST_PARAMS_TEXT, transport: "tzt" };

function requestParamCount(text: string): number {
  try {
    return Object.keys(parseManualRequestParams(text)).length;
  } catch {
    return text.split(/\r?\n/).filter((line) => line.trim() !== "").length;
  }
}

function requestPortError(text: string): string {
  return text.trim() === "" ? "端口不能为空" : "端口必须是 1 - 65535 之间的整数";
}

function formattedBody(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function LineGutter({ count }: { count: number }) {
  return <div className="lf-code-gutter" aria-hidden="true">{Array.from({ length: Math.max(1, count) }, (_, index) => <span key={index}>{index + 1}</span>)}</div>;
}

function ResponseTable({ body }: { body: string }) {
  const rows = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)] as const);
    } catch {
      return [];
    }
  }, [body]);
  if (rows.length === 0) return <div className="lf-response-empty">应答不是可展开的 JSON 对象。</div>;
  return <div className="lf-response-table">{rows.map(([key, value]) => <div key={key}><span>{key}</span><code>{value}</code></div>)}</div>;
}

export function RequestPage({ config, active = true, onChange, onSendRequest, onFillJson, onOpenSession }: RequestPageProps) {
  const initialDraft = config.request ?? defaultRequest;
  const { notify, notifyError } = useToast();
  const [draft, setDraft] = useState<ManualRequestConfig>(() => initialDraft);
  const [portText, setPortText] = useState(() => String(initialDraft.port));
  const [response, setResponse] = useState<ManualRequestResponse>();
  const [running, setRunning] = useState(false);
  const [requestView, setRequestView] = useState<RequestView>("params");
  const [responseView, setResponseView] = useState<ResponseView>("json");

  useEffect(() => {
    const nextDraft = config.request ?? defaultRequest;
    setDraft(nextDraft);
    setPortText(String(nextDraft.port));
  }, [config.request]);

  const saveDraft = async (nextDraft: ManualRequestConfig) => {
    await onChange({ ...config, request: nextDraft });
  };

  const savePort = async () => {
    const port = parseManualRequestPort(portText);
    if (port === undefined) {
      notifyError(requestPortError(portText), "端口输入无效");
      return;
    }
    const nextDraft = { ...draft, port };
    setDraft(nextDraft);
    setPortText(String(port));
    await saveDraft(nextDraft);
  };

  const send = useCallback(async () => {
    if (running) return;
    const port = parseManualRequestPort(portText);
    if (port === undefined) {
      notifyError(requestPortError(portText), "端口输入无效");
      return;
    }
    const request = { ...draft, port };
    try {
      parseManualRequestParams(request.paramsText);
    } catch (cause) {
      notifyError(cause, "请求参数格式无效");
      return;
    }
    setRunning(true);
    try {
      const result = await onSendRequest(request);
      setResponse(result);
      if (result.ok) setResponseView("json");
    } catch (cause) {
      notifyError(cause, "请求失败");
    } finally {
      setRunning(false);
    }
  }, [draft, notifyError, onSendRequest, portText, running]);

  useEffect(() => {
    if (!active) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      void send();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [active, send]);

  const formatParams = () => {
    try {
      const parsed = parseManualRequestParams(draft.paramsText);
      const nextText = Object.entries(parsed).map(([key, value]) => `${key}=${value}`).join("\n");
      setDraft((current) => ({ ...current, paramsText: nextText }));
      void saveDraft({ ...draft, paramsText: nextText });
      notify({ kind: "success", message: "参数已格式化" });
    } catch (cause) {
      notifyError(cause, "参数格式无效");
    }
  };

  const parsedParams = useMemo(() => {
    try {
      return Object.entries(parseManualRequestParams(draft.paramsText));
    } catch {
      return [];
    }
  }, [draft.paramsText]);
  const responseCode = response?.statusCode === undefined
    ? response === undefined ? "—" : draft.transport === "http" ? "HTTP" : "TZT TCP"
    : `${response.statusCode}${response.statusMessage ? ` ${response.statusMessage}` : ""}`;
  const responseBody = response?.body ?? "尚未发送请求";
  const displayResponse = responseView === "json" ? formattedBody(responseBody) : responseBody;
  const transport = draft.transport ?? "tzt";
  const requestAddress = `${transport === "tzt" ? "tcp://" : "http://"}${draft.host || "127.0.0.1"}:${draft.port || "8080"}${transport === "http" ? "/reqxml" : ""}`;
  const requestLines = draft.paramsText.split("\n").length;
  const responseLines = displayResponse.split("\n").length;

  return <section className="lf-request-workspace">
    <section className="lf-panel lf-endpoint-bar" aria-label="请求目标">
      <label className="lf-field"><span>目标主机</span><input className="lf-control mono" value={draft.host} placeholder="例如 127.0.0.1" onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))} onBlur={() => void saveDraft(draft)} /></label>
      <label className="lf-field"><span>端口</span><input className="lf-control mono" type="number" value={portText} placeholder="端口" onChange={(event) => setPortText(event.target.value)} onBlur={() => void savePort()} /></label>
      <div className="lf-field"><span>协议</span><div className="lf-segmented compact" role="group" aria-label="请求协议"><button className={transport === "tzt" ? "active" : ""} type="button" onClick={() => { const next = { ...draft, transport: "tzt" as const }; setDraft(next); void saveDraft(next); }}>TZT TCP</button><button className={transport === "http" ? "active" : ""} type="button" onClick={() => { const next = { ...draft, transport: "http" as const }; setDraft(next); void saveDraft(next); }}>HTTP /reqxml</button></div></div>
      <label className="lf-field"><span>解析后的地址</span><input className="lf-control mono" readOnly value={requestAddress} /></label>
      <button className="lf-btn primary lf-send-button" type="button" disabled={running} onClick={() => void send()}><WorkspaceIcon name="send" className="lf-icon" />{running ? "发送中…" : "发送请求"}<kbd>⌘↵</kbd></button>
    </section>

    <div className="lf-debug-grid">
      <section className="lf-panel lf-request-card">
        <div className="lf-card-head">
          <div className="lf-card-title"><h3>请求参数</h3><span className="lf-count-pill">{requestParamCount(draft.paramsText)} 个参数</span></div>
          <div className="lf-tabs" role="tablist" aria-label="请求参数视图">{[["params", "参数"], ["raw", "原始"], ["form", "表单"]].map(([value, label]) => <button className={requestView === value ? "active" : ""} type="button" role="tab" aria-selected={requestView === value} key={value} onClick={() => setRequestView(value as RequestView)}>{label}</button>)}</div>
        </div>
        {requestView === "params" ? <div className="lf-request-editor"><LineGutter count={requestLines} /><textarea className="lf-request-textarea" aria-label="请求参数" value={draft.paramsText} spellCheck={false} onChange={(event) => setDraft((current) => ({ ...current, paramsText: event.target.value }))} onBlur={() => void saveDraft(draft)} /></div> : requestView === "raw" ? <pre className="lf-request-code">{draft.paramsText || " "}</pre> : <div className="lf-request-form">{parsedParams.length === 0 ? <p>参数格式无效，切换到参数视图检查。</p> : parsedParams.map(([key, value]) => <div key={key}><span>{key}</span><code>{value}</code></div>)}</div>}
        <div className="lf-request-foot"><span><code>键=值</code> · 每行一个参数 · <code>;</code> 开头为注释</span><button className="lf-text-button" type="button" onClick={formatParams}>格式化</button></div>
      </section>

      <section className="lf-panel lf-response-card">
        <div className="lf-card-head">
          <div className="lf-card-title"><h3>应答内容</h3>{response !== undefined && <span className={`lf-status-ok ${response.ok ? "" : "error"}`}>{response.ok ? <span className="lf-status-dot running" /> : null}{responseCode}</span>}{response?.durationMs !== undefined && <span className="lf-duration">{response.durationMs} ms</span>}</div>
          <div className="lf-tabs" role="tablist" aria-label="应答视图">{[["json", "JSON"], ["table", "表格"], ["raw", "原始"]].map(([value, label]) => <button className={responseView === value ? "active" : ""} type="button" role="tab" aria-selected={responseView === value} key={value} onClick={() => setResponseView(value as ResponseView)}>{label}</button>)}</div>
        </div>
        {response?.loginSuccess && <div className="lf-response-banner"><WorkspaceIcon name="check" className="lf-icon" /><span><strong>登录成功</strong> · 已更新登录缓存字段</span>{onOpenSession !== undefined && <button className="lf-text-button" type="button" onClick={onOpenSession}>查看</button>}</div>}
        {response !== undefined && !response.ok && <div className="lf-response-banner error"><WorkspaceIcon name="history" className="lf-icon" /><span><strong>请求失败</strong> · {response.error ?? "请检查目标和参数"}</span></div>}
        {responseView === "table" ? <div className="lf-response-table-wrap"><ResponseTable body={responseBody} /></div> : <div className="lf-response-editor"><LineGutter count={responseLines} /><pre className="lf-response-code">{displayResponse}</pre></div>}
        <div className="lf-response-foot"><span>{response === undefined ? "发送后在这里查看应答" : `${responseBody.length.toLocaleString("zh-CN")} 字符`}</span><button className="lf-text-button" type="button" disabled={response === undefined} onClick={() => onFillJson(responseBody)}>回填到 JSON 可视化</button></div>
      </section>
    </div>
  </section>;
}
