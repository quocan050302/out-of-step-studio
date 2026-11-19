import { useEffect, useState } from "react";
import Sidebar, { MobileBottomNav } from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import { useGeminiStudio } from "./hooks/useGeminiStudio.js";
import DashboardPage from "./pages/DashboardPage.jsx";
import ScriptPage from "./pages/ScriptPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import StillCheckPage from "./pages/StillCheckPage.jsx";

export default function App() {
  const [panel, setPanel] = useState("dashboard");
  const [theme, setTheme] = useState(() => localStorage.getItem("oos-theme") || "dark");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("oos-sidebar-collapsed") === "1",
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const studio = useGeminiStudio();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("oos-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("oos-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  // Keep all four panels mounted so form inputs, file previews, and generated results survive tab navigation.
  return (
    <div className="layout">
      <Sidebar
        panel={panel}
        onSelectPanel={setPanel}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="app-shell-body">
        <Topbar
          panel={panel}
          connection={studio.connection}
          providers={studio.providers}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSettings={() => setPanel("settings")}
        />

        <main className="main" id="main-content">
          {studio.settingsError && (
            <div className="error-box global-settings-error" role="alert">
              <strong>Backend API unreachable:</strong> {studio.settingsError}
            </div>
          )}

          <div className={panel === "dashboard" ? "panel-host active" : "panel-host"}>
            <DashboardPage
              connection={studio.connection}
              providers={studio.providers}
              catalog={studio.catalog}
              onNavigate={setPanel}
            />
          </div>

          <div className={panel === "script" ? "panel-host active" : "panel-host"}>
            <ScriptPage
              providers={studio.providers}
              onRefreshHealth={studio.refreshHealth}
              onOpenSettings={() => setPanel("settings")}
            />
          </div>

          <div className={panel === "still" ? "panel-host active" : "panel-host"}>
            <StillCheckPage
              providers={studio.providers}
              onRefreshHealth={studio.refreshHealth}
              onOpenSettings={() => setPanel("settings")}
            />
          </div>

          <div className={panel === "settings" ? "panel-host active" : "panel-host"}>
            <SettingsPage
              providers={studio.providers}
              epoch={studio.settingsEpoch}
              catalog={studio.catalog}
              connection={studio.connection}
              testing={studio.testing}
              testProgress={studio.testProgress}
              testResult={studio.testResult}
              onSave={studio.saveProvider}
              onDiscover={studio.discoverModels}
              onRunTest={studio.runConnectionTest}
              onCancelTest={studio.cancelConnectionTest}
            />
          </div>
        </main>

        <MobileBottomNav panel={panel} onSelectPanel={setPanel} />
      </div>
    </div>
  );
}
