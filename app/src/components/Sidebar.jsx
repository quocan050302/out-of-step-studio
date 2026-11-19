import { useEffect } from "react";
import {
  FileText,
  LayoutDashboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ScanEye,
  Settings,
  Sun,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", sub: "Pipeline & health", Icon: LayoutDashboard },
  { id: "script", label: "Script", sub: "Narration beats", Icon: FileText },
  { id: "still", label: "Still Check", sub: "Vision frame QA", Icon: ScanEye },
  { id: "settings", label: "Settings", sub: "Models & API keys", Icon: Settings },
];

export function MobileBottomNav({ panel, onSelectPanel }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile quick navigation">
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const active = panel === id;
        return (
          <button
            key={id}
            type="button"
            className={"mobile-nav-btn" + (active ? " active" : "")}
            data-mobile-panel={id}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelectPanel(id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function Sidebar({
  panel,
  onSelectPanel,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  theme,
  onToggleTheme,
}) {
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onCloseMobile();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  function handlePick(id) {
    onSelectPanel(id);
    onCloseMobile();
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={
          "sidebar" +
          (collapsed ? " sidebar-collapsed" : "") +
          (mobileOpen ? " sidebar-mobile-open" : "")
        }
        aria-label="Primary studio navigation"
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">OS</div>
            {!collapsed && (
              <div className="brand-copy">
                <div className="brand-name">Out of Step</div>
                <div className="brand-sub">Production Studio</div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="icon-btn desktop-only"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <button
            type="button"
            className="icon-btn mobile-only"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="nav" aria-label="Studio sections">
          {NAV_ITEMS.map(({ id, label, sub, Icon }) => {
            const active = panel === id;
            return (
              <button
                key={id}
                type="button"
                className={"nav-item" + (active ? " active" : "")}
                data-panel={id}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                onClick={() => handlePick(id)}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                {!collapsed && (
                  <span className="nav-labels">
                    <span className="nav-title">{label}</span>
                    <span className="nav-sub">{sub}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {!collapsed && (
            <div className="arch-chip">
              <span className="arch-dot" aria-hidden="true" />
              <span>AI Script &amp; QA · Code Render</span>
            </div>
          )}
          <button
            type="button"
            className="ghost-btn sidebar-theme-btn"
            onClick={onToggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            {!collapsed && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
