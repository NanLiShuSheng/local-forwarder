import { useMemo, useState } from "react";
import type { AppConfig, ForwardRule } from "../../shared/contracts";

interface RuleListProps { config: AppConfig; onChange: (config: AppConfig) => Promise<void>; }

export function RuleList({ config, onChange }: RuleListProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const rules = useMemo(() => config.httpRules.filter((rule) => `${rule.name} ${rule.match} ${rule.target}`.toLowerCase().includes(query.toLowerCase())), [config.httpRules, query]);
  const toggle = async (rule: ForwardRule) => onChange({ ...config, httpRules: config.httpRules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item) });
  return <section className="panel rules-panel"><div className="panel-heading"><div><p className="eyebrow">Forwarding rules</p><h2>Rules</h2></div><input aria-label="Search rules" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="rule-list">{rules.length === 0 && <p className="empty">No matching rules.</p>}{rules.map((rule) => <button className={`rule-row ${selectedId === rule.id ? "selected" : ""}`} key={rule.id} onClick={() => setSelectedId(rule.id)}><span className={`rule-state ${rule.enabled ? "on" : "off"}`} /><span className="rule-copy"><strong>{rule.name}</strong><small>{rule.match} → {rule.target}</small></span><span className="rule-actions"><span>{rule.enabled ? "Enabled" : "Disabled"}</span><span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void toggle(rule); }}>{rule.enabled ? "Disable" : "Enable"}</span></span></button>)}</div></section>;
}
