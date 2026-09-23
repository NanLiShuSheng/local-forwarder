import { useEffect, useState } from "react";
import type { AppConfig, StringToolConfig, StringToolOperation } from "../../shared/contracts";
import { applyStringOperation } from "../../shared/string-tool";
import { useToast } from "./ToastProvider";

interface StringToolPageProps {
  config: AppConfig;
}

const defaultStringTool: StringToolConfig = {
  inputText: "",
  outputText: "",
  operation: "replace",
  findText: "",
  replaceText: "",
};

export function StringToolPage({ config }: StringToolPageProps) {
  const { notifyError } = useToast();
  const [draft, setDraft] = useState<StringToolConfig>(() => config.stringTool ?? defaultStringTool);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    setDraft(config.stringTool ?? defaultStringTool);
  }, [config.stringTool]);

  const updateDraft = (patch: Partial<StringToolConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setCopyStatus("");
  };

  const execute = async () => {
    try {
      const outputText = applyStringOperation(draft.inputText, draft.operation, draft.findText, draft.replaceText);
      const next = { ...draft, outputText };
      setDraft(next);
    } catch (cause) {
      notifyError(cause, "字符串处理失败");
    }
  };

  const clear = async () => {
    const next = { ...defaultStringTool };
    setDraft(next);
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(draft.outputText);
      setCopyStatus("已复制");
    } catch (cause) {
      notifyError(cause, "复制结果失败");
    }
  };

  const showSearchFields = draft.operation === "replace" || draft.operation === "remove";
  return <section className="panel string-tool-panel">
    <div className="string-tool-controls">
      <label>处理操作<select className="select-control" value={draft.operation} onChange={(event) => updateDraft({ operation: event.target.value as StringToolOperation })}><option value="replace">查找并替换</option><option value="remove">删除指定内容</option><option value="uppercase">转换为大写</option><option value="lowercase">转换为小写</option><option value="url-encode">URL 编码</option><option value="url-decode">URL 解码</option><option value="json-format">JSON 格式化</option></select></label>
      {showSearchFields && <label>查找内容<input value={draft.findText} onChange={(event) => updateDraft({ findText: event.target.value })} /></label>}
      {draft.operation === "replace" && <label>替换为<input value={draft.replaceText} onChange={(event) => updateDraft({ replaceText: event.target.value })} /></label>}
      <div className="string-tool-actions"><button type="button" className="secondary-button" onClick={() => void clear()}>清空</button><button type="button" className="primary-button" onClick={() => void execute()}>执行处理</button></div>
    </div>
    <div className="string-tool-workspace">
      <section className="string-tool-card"><div className="string-tool-card-heading"><h3>输入字符串</h3><span>可直接粘贴多行文本</span></div><textarea className="string-tool-textarea" aria-label="输入字符串" value={draft.inputText} onChange={(event) => updateDraft({ inputText: event.target.value })} /><div className="string-tool-footer"><span>{draft.inputText.length} 个字符</span><span>仅在当前页面保留</span></div></section>
      <div className="string-tool-arrow" aria-hidden="true">→</div>
      <section className="string-tool-card"><div className="string-tool-card-heading"><h3>处理结果</h3><span>{copyStatus || "可编辑并复制"}</span></div><textarea className="string-tool-textarea" aria-label="处理结果" value={draft.outputText} onChange={(event) => updateDraft({ outputText: event.target.value })} /><div className="string-tool-footer"><span>{draft.outputText.length} 个字符</span><button type="button" className="secondary-button" onClick={() => void copyResult()}>复制结果</button></div></section>
    </div>
  </section>;
}
