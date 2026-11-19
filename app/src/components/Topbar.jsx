import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HelpCircle,
  Loader2,
  Menu,
  Moon,
  ShieldAlert,
  Sun,
} from "lucide-react";

const PAGE_META = {
  dashboard: {
    title: "Studio Overview",
    subtitle: "Hybrid short-film pipeline: Gemini writes & checks frames; Remotion + Python render every pixel & waveform.",
  },
  script: {
    title: "Script Generator",
    subtitle: "Generate timed narration beats structured for vertical (9:16) story shorts on any topic.",
  },
  still: {
    title: "Still Frame QA",
    subtitle: "Inspect rendered frames with Gemini Vision for clipping, blank regions, and composition fidelity.",
  },
  settings: {
    title: "Settings & Model Routing",
    subtitle: "Local API credentials, automatic Gemini model discovery, capability ranking, and 503 fallback controls.",
  },
};

function StatusIcon({ state }) {
  if (state === "testing") return <Loader2 size={14} className="spin" aria-hidden="true" />;
  if (state === "connected") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (state === "degraded-fallback" || state === "stale") {
    return <AlertTriangle size={14} aria-hidden="true" />;
  }
  if (state === "blocked" || state === "failed") {
    return <ShieldAlert size={14} aria-hidden="true" />;
  }
  return <HelpCircle size={14} aria-hidden="true" />;
}

export default function Topbar({
  panel,
  connection,
  providers,
  theme,
  onToggleTheme,
  onOpenMobileMenu,
  onOpenSettings,
}) {
  const meta = PAGE_META[panel] || PAGE_META.dashboard;
  const gemini = providers?.gemini || {};
  const textHealth = gemini.health?.capabilities?.text;
  const activeModel =
    textHealth?.activeModel ||
    textHealth?.verifiedModel ||
    (gemini.hasKey ? gemini.textModel : null);
  const modeLabel =
    gemini.selectionMode === "manual"
      ? "Manual"
      : gemini.modelPolicy === "balanced"
        ? "Auto · Balanced"
        : gemini.modelPolicy === "fast"
          ? "Auto · Fast"
          : "Auto · Highest quality";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn mobile-only"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>
        <div className="topbar-titles">
          <div className="topbar-title">{meta.title}</div>
          <p className="topbar-sub">{meta.subtitle}</p>
        </div>
      </div>

      <div className="topbar-actions">
        {gemini.hasKey && (
          <button
            type="button"
            className="model-summary-chip"
            onClick={onOpenSettings}
            title="Inspect Gemini model routing in Settings"
          >
            <Cpu size={14} aria-hidden="true" />
            <span className="model-chip-mode">{modeLabel}</span>
            {activeModel && <code className="model-chip-id">{activeModel}</code>}
          </button>
        )}

        <button
          type="button"
          id="conn-pill"
          className={connection.className + " pill-interactive"}
          onClick={onOpenSettings}
          title="Open Gemini connection settings"
        >
          <StatusIcon state={connection.state} />
          <span>{connection.text}</span>
        </button>

        <button
          id="theme-toggle"
          className="ghost-btn topbar-theme-btn"
          type="button"
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </header>
  );
}
