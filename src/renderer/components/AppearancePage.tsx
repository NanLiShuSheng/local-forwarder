import type { ResolvedTheme, ThemeMode } from "../theme";

export interface AppearancePageProps {
  mode: ThemeMode;
  theme: ResolvedTheme;
  onModeChange: (next: ThemeMode) => void;
}

const themeOptions: Array<{ mode: ThemeMode; label: string; description: string }> = [
  { mode: "system", label: "跟随系统", description: "根据系统外观自动切换" },
  { mode: "light", label: "浅色", description: "使用明亮的应用界面" },
  { mode: "dark", label: "深色", description: "使用深色的应用界面" },
];

const resolvedThemeLabels: Record<ResolvedTheme, string> = { light: "浅色", dark: "深色" };

export function AppearancePage({ mode, theme, onModeChange }: AppearancePageProps) {
  return <section className="panel appearance-page appearance-theme-panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">偏好设置</p>
        <h2>外观</h2>
      </div>
    </div>
    <p className="muted">当前解析主题：{resolvedThemeLabels[theme]}</p>
    <p className="muted">切换主题后立即生效，无需重启应用。</p>
    <div className="appearance-theme-grid" role="group" aria-label="主题模式">
      {themeOptions.map((option) => <button
        type="button"
        key={option.mode}
        className={`appearance-theme-card ${mode === option.mode ? "selected" : ""}`}
        aria-pressed={mode === option.mode}
        onClick={() => onModeChange(option.mode)}
      >
        <span className="appearance-theme-preview" aria-hidden="true" />
        <span className="appearance-theme-card-copy">
          <span className="appearance-theme-card-label">
            <strong>{option.label}</strong>
            {option.mode === "system" && <em className="appearance-theme-default">默认</em>}
          </span>
          <span>{option.description}</span>
        </span>
        {mode === option.mode && <span className="appearance-theme-card-check" aria-hidden="true">✓</span>}
      </button>)}
    </div>
  </section>;
}
