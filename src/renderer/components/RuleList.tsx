import { useMemo, useState } from "react";
import type { AppConfig, ForwardRule } from "../../shared/contracts";

interface RuleListProps { config: AppConfig; onChange: (config: AppConfig) => Promise<void>; }

export function RuleList({ config, onChange }: RuleListProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const rules = useMemo(() => config.httpRules.filter((rule) => `${rule.name} ${rule.match} ${rule.target}`.toLowerCase().includes(query.toLowerCase())), [config.httpRules, query]);
  const toggle = async (rule: ForwardRule) => onChange({ ...config, httpRules: config.httpRules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item) });
  return <section className="panel rules-panel"><div className="panel-heading"><div><p className="eyebrow">转发规则</p><h2>规则</h2></div><input aria-label="搜索规则" placeholder="搜索" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="rule-list">{rules.length === 0 && <p className="empty">暂无匹配规则。</p>}{rules.map((rule) => <button className={`rule-row ${selectedId === rule.id ? "selected" : ""}`} key={rule.id} onClick={() => setSelectedId(rule.id)}><span className={`rule-state ${rule.enabled ? "on" : "off"}`} /><span className="rule-copy"><strong>{rule.name}</strong><small>{rule.match} → {rule.target}</small></span><span className="rule-actions"><span>{rule.enabled ? "已启用" : "已停用"}</span><span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void toggle(rule); }}>{rule.enabled ? "停用" : "启用"}</span></span></button>)}</div></section>;
}
