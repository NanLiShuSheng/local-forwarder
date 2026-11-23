import { useEffect, useState } from "react";
import type { AppConfig, ManualRequestConfig, ManualRequestResponse } from "../../shared/contracts";
import { DEFAULT_REQUEST_HOST, DEFAULT_REQUEST_PARAMS_TEXT, DEFAULT_REQUEST_PORT } from "../../shared/config-defaults";
import { parseManualRequestParams, parseManualRequestPort } from "../../shared/manual-request";
import { useToast } from "./ToastProvider";

interface RequestPageProps {
  config: AppConfig;
  onChange: (config: AppConfig) => Promise<boolean>;
  onSendRequest: (request: ManualRequestConfig) => Promise<ManualRequestResponse>;
  onFillJson: (text: string) => void;
}

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

export function RequestPage({ config, onChange, onSendRequest, onFillJson }: RequestPageProps) {
  const initialDraft = config.request ?? defaultRequest;
  const { notifyError } = useToast();
  const [draft, setDraft] = useState<ManualRequestConfig>(() => initialDraft);
  const [portText, setPortText] = useState(() => String(initialDraft.port));
  const [response, setResponse] = useState<ManualRequestResponse>();
  const [running, setRunning] = useState(false);

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

  const send = async () => {
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
    } catch (cause) {
      notifyError(cause, "请求失败");
    } finally {
      setRunning(false);
    }
  };

  const responseCode = response?.statusCode === undefined
    ? response === undefined ? "—" : draft.transport === "http" ? "—" : "TZT TCP"
    : `${response.statusCode}${response.statusMessage ? ` ${response.statusMessage}` : ""}`;
  const responseBody = response?.body ?? "尚未发送请求";
  const transport = draft.transport ?? "tzt";

  return <section className="panel request-panel">
    <div className="login-cache-notice" role="note" aria-labelledby="login-cache-notice-title">
      <span className="login-cache-notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg></span>
      <div className="login-cache-notice-copy">
        <strong id="login-cache-notice-title">登录请求会自动缓存应答值</strong>
        <span className="login-cache-notice-detail"><code>Action = 100 / 104 / 105</code><span>成功后自动写入当前代理；普通请求不会触发缓存。</span></span>
      </div>
      <span className="login-cache-notice-tag">当前代理</span>
    </div>
    <div className="request-endpoint">
      <label>目标 IP<input value={draft.host} placeholder="例如 127.0.0.1" onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))} onBlur={() => void saveDraft(draft)} /></label>
      <label>端口<input type="number" value={portText} placeholder="端口" onChange={(event) => setPortText(event.target.value)} onBlur={() => void savePort()} /></label>
      <label>协议<select className="select-control request-transport-select" value={transport} onChange={(event) => { const next = { ...draft, transport: event.target.value as "tzt" | "http" }; setDraft(next); void saveDraft(next); }}><option value="tzt">TZT TCP（原生协议）</option><option value="http">HTTP /reqxml</option></select></label>
      <div className="request-url"><span>{transport === "tzt" ? "tcp://" : "http://"}</span><strong>{draft.host || "127.0.0.1"}:{draft.port || "8080"}{transport === "tzt" ? "" : "/reqxml"}</strong></div>
    </div>
    <div className="request-workspace">
      <section className="request-card">
        <div className="request-card-heading">
          <div><p className="eyebrow">Request</p><h3>请求参数</h3></div>
          <div className="request-heading-actions">
            <span className="request-param-count">{requestParamCount(draft.paramsText)} 个参数</span>
            <button type="button" className="primary-button request-send-button" disabled={running} onClick={() => void send()}>发送请求</button>
          </div>
        </div>
        <textarea className="request-input" aria-label="请求参数" value={draft.paramsText} onChange={(event) => setDraft((current) => ({ ...current, paramsText: event.target.value }))} onBlur={() => void saveDraft(draft)} placeholder="Action=100\naccount=600554432" rows={12} />
        <p className="request-hint"><code>键=值</code>，每行一个参数；分号开头的行是注释，重复键取最后一个值。</p>
      </section>
      <section className="request-card response-card">
        <div className="request-card-heading">
          <div><p className="eyebrow">Response</p><h3>应答内容</h3></div>
          <div className="response-actions"><span className="response-duration">耗时 {response?.durationMs === undefined ? "—" : response.durationMs} ms</span><div className="response-copy-actions"><button type="button" className="secondary-button" disabled={response?.body === undefined} onClick={() => { if (response?.body !== undefined) onFillJson(response.body); }}>回填到 JSON 可视化</button></div></div>
        </div>
        <div className="response-code">{responseCode}</div>
        <pre className="response-body">{responseBody}</pre>
      </section>
    </div>
  </section>;
}
