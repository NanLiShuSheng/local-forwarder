import { useState } from "react";
import type { ResolvedTheme, ThemeMode } from "../theme";

export interface AppearancePageProps {
  mode: ThemeMode;
  theme: ResolvedTheme;
  onModeChange: (next: ThemeMode) => void;
}

const themeOptions: Array<{ mode: ThemeMode; label: string; description: string }> = [
  { mode: "light", label: "浅色", description: "明亮的工作台界面" },
  { mode: "dark", label: "深色", description: "低亮度调试环境" },
  { mode: "system", label: "跟随系统", description: "随 macOS 自动切换" },
];

const resolvedThemeLabels: Record<ResolvedTheme, string> = { light: "浅色", dark: "深色" };

export function AppearancePage({ mode, theme, onModeChange }: AppearancePageProps) {
  const [compact, setCompact] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  return <>
    <div className="lf-theme-grid" role="group" aria-label="主题">
      {themeOptions.map((option) => <button
        type="button"
        key={option.mode}
        data-theme-option={option.mode}
        className={`lf-theme-card ${mode === option.mode ? "active" : ""}`}
        aria-pressed={mode === option.mode}
        onClick={() => onModeChange(option.mode)}
      >
        <span className="lf-theme-preview" aria-hidden="true" />
        <span className="lf-theme-copy"><span><strong>{option.label}</strong><span>{option.description}</span></span>{mode === option.mode && <span className="lf-theme-check" aria-hidden="true">✓</span>}</span>
      </button>)}
    </div>
    <section className="lf-panel lf-settings-panel">
      <h3>界面密度</h3>
      <p>工作台默认使用紧凑布局，优先展示状态、请求和日志。当前解析主题：{resolvedThemeLabels[theme]}。</p>
      <div className="lf-settings-row"><span>紧凑模式</span><button className={`lf-switch ${compact ? "on" : ""}`} type="button" aria-label="紧凑模式" aria-pressed={compact} onClick={() => setCompact((current) => !current)} /></div>
      <div className="lf-settings-row"><span>减少动效</span><button className={`lf-switch ${reduceMotion ? "on" : ""}`} type="button" aria-label="减少动效" aria-pressed={reduceMotion} onClick={() => setReduceMotion((current) => !current)} /></div>
    </section>
  </>;
}
