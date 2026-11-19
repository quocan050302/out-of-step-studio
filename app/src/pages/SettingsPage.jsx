import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldAlert,
  Sliders,
  XCircle,
} from "lucide-react";
import { useElapsedSeconds } from "../hooks/useGeminiStudio.js";
import {
  POLICY_LABELS,
  PROVIDER_LABELS,
  formatRelativeTime,
} from "../lib/studio.mjs";

const CAPABILITY_META = [
  {
    key: "text",
    field: "textModel",
    label: "Text · Script Generation",
    desc: "Used by POST /api/script and connection verification.",
  },
  {
    key: "vision",
    field: "visionModel",
    label: "Vision · Still Check QA",
    desc: "Multimodal image-capable models for POST /api/check-still.",
  },
  {
    key: "tts",
    field: "ttsModel",
    label: "Audio · TTS (Experimental)",
    desc: "Audio speechConfig models only for POST /api/tts.",
  },
];

function UnintegratedProviderCard({ name, cfg, onSave }) {
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData(e.currentTarget);
    const rawKey = String(fd.get("apiKey") || "").trim();
    const fields = {};
    if (rawKey) fields.apiKey = rawKey;
    setSaving(true);
    setStatusMsg(null);
    try {
      const out = await onSave(name, fields);
      if (out.ok) {
        setStatusMsg({ type: "ok", text: rawKey ? "Key saved locally (provider not integrated yet)." : "Settings unchanged." });
      } else {
        setStatusMsg({ type: "bad", text: "Failed: " + (out.error || "unknown error") });
      }
    } catch (err) {
      setStatusMsg({ type: "bad", text: "Failed: " + String(err?.message || err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card provider-secondary-card">
      <div className="card-top">
        <h3>{PROVIDER_LABELS[name] || name}</h3>
        <span className="step-badge badge-muted">Not integrated yet</span>
      </div>
      <p className="note">
        Reserved for future multi-provider support. Keys stored locally only; no Studio endpoints call {PROVIDER_LABELS[name] || name} yet.
      </p>
      <form className="form form-compact" data-provider={name} onSubmit={handleSubmit}>
        <label>
          <span>API key</span>
          <input
            type="password"
            data-field="apiKey"
            name="apiKey"
            autoComplete="off"
            placeholder={cfg?.hasKey ? `Current: ${cfg.apiKey} — type to replace` : "Paste API key (optional)"}
          />
        </label>
        <div className="btn-row">
          <button className="secondary-btn btn-sm" type="submit" disabled={saving}>
            <Save size={14} aria-hidden="true" />
            <span>{saving ? "Saving…" : "Save"}</span>
          </button>
        </div>
        {statusMsg && (
          <div className={"test-line " + statusMsg.type} role="status">
            {statusMsg.text}
          </div>
        )}
      </form>
    </article>
  );
}

export default function SettingsPage({
  providers,
  epoch,
  catalog,
  connection,
  testing,
  testProgress,
  testResult,
  onSave,
  onDiscover,
  onRunTest,
  onCancelTest,
}) {
  const gemini = providers?.gemini || {
    apiKey: "",
    hasKey: false,
    textModel: "gemini-3.8-flash",
    visionModel: "gemini-3.8-flash",
    ttsModel: "gemini-3.8-flash-tts",
    selectionMode: "auto",
    modelPolicy: "quality",
    includePreview: false,
    integrated: true,
  };

  const [selectionMode, setSelectionMode] = useState(gemini.selectionMode || "auto");
  const [modelPolicy, setModelPolicy] = useState(gemini.modelPolicy || "quality");
  const [includePreview, setIncludePreview] = useState(Boolean(gemini.includePreview));
  const [textModel, setTextModel] = useState(gemini.textModel || "gemini-3.8-flash");
  const [visionModel, setVisionModel] = useState(gemini.visionModel || "gemini-3.8-flash");
  const [ttsModel, setTtsModel] = useState(gemini.ttsModel || "gemini-3.8-flash-tts");
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState(null);

  useEffect(() => {
    if (!providers?.gemini) return;
    const g = providers.gemini;
    setSelectionMode(g.selectionMode || "auto");
    setModelPolicy(g.modelPolicy || "quality");
    setIncludePreview(Boolean(g.includePreview));
    if (g.textModel) setTextModel(g.textModel);
    if (g.visionModel) setVisionModel(g.visionModel);
    if (g.ttsModel) setTtsModel(g.ttsModel);
  }, [providers?.gemini]);

  const testElapsed = useElapsedSeconds(testing);

  const health = gemini.health || {};
  const capHealth = health.capabilities || {};
  const recentTrails = Array.isArray(health.recentTrails) ? health.recentTrails : [];

  const modelStateByField = {
    textModel: [textModel, setTextModel],
    visionModel: [visionModel, setVisionModel],
    ttsModel: [ttsModel, setTtsModel],
  };

  async function handleSaveGemini(event) {
    event.preventDefault();
    if (saving) return;
    const formEl = event.currentTarget;
    const fd = new FormData(formEl);
    const rawKey = String(fd.get("apiKey") || "").trim();

    const fields = {
      selectionMode,
      modelPolicy,
      includePreview: String(includePreview),
      textModel,
      visionModel,
      ttsModel,
    };
    if (rawKey) {
      fields.apiKey = rawKey;
    }

    setSaving(true);
    setSaveBanner(null);
    try {
      const out = await onSave("gemini", fields);
      if (out.ok) {
        if (formEl?.isConnected) formEl.reset();
        setSaveBanner({
          type: "ok",
          text: rawKey
            ? "API key and routing policy saved locally."
            : "Routing policy saved (existing API key preserved).",
        });
      } else {
        setSaveBanner({
          type: "bad",
          text: "Failed to save: " + (out.error || "unknown error"),
        });
      }
    } catch (err) {
      setSaveBanner({
        type: "bad",
        text: "Failed to save: " + String(err?.message || err),
      });
    } finally {
      setSaving(false);
    }
  }

  let testSummaryLine = "";
  let testSummaryClass = "";
  if (testing) {
    const latestEvt = testProgress.at(-1);
    testSummaryLine = `${latestEvt?.message || "Testing Gemini connection…"} (${testElapsed}s elapsed)`;
    testSummaryClass = "testing";
  } else if (testResult) {
    if (testResult.ok) {
      testSummaryClass = testResult.downgraded ? "warn" : "ok";
      testSummaryLine = testResult.downgraded
        ? `Connected via fallback ${testResult.effectiveModel || testResult.model} (preferred ${testResult.preferredModel} overloaded) — replied "${testResult.reply}" in ${(testResult.latencyMs / 1000).toFixed(1)}s.`
        : `Connected — ${testResult.effectiveModel || testResult.model} replied "${testResult.reply}" in ${(testResult.latencyMs / 1000).toFixed(1)}s.`;
    } else if (testResult.aborted) {
      testSummaryClass = "";
      testSummaryLine = "Connection test cancelled.";
    } else {
      testSummaryClass = "bad";
      testSummaryLine = `Failed: ${testResult.error || "Connection verification failed."}`;
    }
  }

  const otherProviders = Object.entries(providers || {}).filter(([name]) => name !== "gemini");

  return (
    <section id="panel-settings" className="panel active" aria-labelledby="settings-heading">
      <div className="security-banner">
        <Lock size={16} aria-hidden="true" />
        <span>
          Keys are persisted exclusively in gitignored <code>app/data/settings.json</code> on this machine. Full API keys
          never enter browser state, Vite environment variables, or Git commits.
        </span>
      </div>

      <div id="provider-cards" className="settings-layout">
        <form
          key={"gemini-form:" + epoch}
          className="gemini-grid"
          data-provider="gemini"
          onSubmit={handleSaveGemini}
        >
          {/* Left Panel: Credentials, Policy & Live Connection Verification */}
          <article className="card gemini-primary-card">
            <header className="gemini-card-head">
              <div>
                <span className="card-kind">INTEGRATED AI PROVIDER</span>
                <h1 id="settings-heading">{PROVIDER_LABELS.gemini}</h1>
              </div>
              <span className={connection.className}>{connection.text}</span>
            </header>

            <div className="form-section">
              <label htmlFor="gemini-api-key">
                <span className="label-row">
                  <KeyRound size={14} aria-hidden="true" />
                  <span>Google AI Studio API Key</span>
                  {gemini.hasKey && <span className="saved-key-pill">Saved: {gemini.apiKey}</span>}
                </span>
                <input
                  id="gemini-api-key"
                  type="password"
                  data-field="apiKey"
                  name="apiKey"
                  autoComplete="off"
                  placeholder={
                    gemini.hasKey
                      ? `Current: ${gemini.apiKey} — leave blank to keep existing key`
                      : "Paste Google AI Studio API key"
                  }
                />
              </label>
            </div>

            <fieldset className="policy-fieldset">
              <legend>
                <Sliders size={14} aria-hidden="true" />
                <span>Model Selection Mode</span>
              </legend>
              <div className="segmented-control" role="radiogroup" aria-label="Model selection mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectionMode === "auto"}
                  className={"seg-btn" + (selectionMode === "auto" ? " active" : "")}
                  data-mode="auto"
                  onClick={() => setSelectionMode("auto")}
                >
                  <strong>Auto Discovery &amp; Fallback</strong>
                  <span>Ranks live account catalog &amp; handles 503</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectionMode === "manual"}
                  className={"seg-btn" + (selectionMode === "manual" ? " active" : "")}
                  data-mode="manual"
                  onClick={() => setSelectionMode("manual")}
                >
                  <strong>Manual Model Pin</strong>
                  <span>Starts at chosen model; never upgrades tier</span>
                </button>
              </div>
            </fieldset>

            {selectionMode === "auto" && (
              <div className="policy-box">
                <label htmlFor="gemini-policy-select">
                  <span>Auto Ranking Policy</span>
                  <select
                    id="gemini-policy-select"
                    name="modelPolicy"
                    data-field="modelPolicy"
                    value={modelPolicy}
                    onChange={(e) => setModelPolicy(e.target.value)}
                  >
                    {Object.entries(POLICY_LABELS).map(([val, info]) => (
                      <option key={val} value={val}>
                        {info.title} — {info.subtitle}
                      </option>
                    ))}
                  </select>
                </label>

                {modelPolicy === "quality" && (
                  <div className="cost-guardrail-note">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>
                      <strong>Cost &amp; Quota Guardrail:</strong> <em>Highest quality</em> prioritizes{" "}
                      <code>Pro</code> models before falling back to <code>Flash</code>. Switch to{" "}
                      <strong>Balanced</strong> if you want lower latency or tighter Free Tier quota usage.
                    </span>
                  </div>
                )}

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={includePreview}
                    onChange={(e) => setIncludePreview(e.target.checked)}
                  />
                  <span>Allow preview / experimental models in automatic ranking</span>
                </label>
              </div>
            )}

            <div className="btn-row">
              <button className="primary-btn" type="submit" disabled={saving}>
                <Save size={15} aria-hidden="true" />
                <span>{saving ? "Saving…" : "Save"}</span>
              </button>

              <button
                className="secondary-btn"
                type="button"
                data-test="gemini"
                disabled={testing}
                onClick={onRunTest}
              >
                {testing ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Activity size={15} aria-hidden="true" />
                )}
                <span>{testing ? "Testing…" : "Test connection"}</span>
              </button>

              {testing && (
                <button
                  className="ghost-btn"
                  type="button"
                  data-cancel-test="gemini"
                  onClick={onCancelTest}
                >
                  <XCircle size={15} aria-hidden="true" />
                  <span>Cancel</span>
                </button>
              )}

              <button
                className="ghost-btn"
                type="button"
                data-discover="gemini"
                disabled={catalog.loading || !gemini.hasKey}
                onClick={onDiscover}
              >
                <RefreshCw size={15} className={catalog.loading ? "spin" : ""} aria-hidden="true" />
                <span>{catalog.loading ? "Syncing…" : "Discover models"}</span>
              </button>
            </div>

            {saveBanner && (
              <div className={"status-callout " + saveBanner.type} role="status">
                {saveBanner.type === "ok" ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <ShieldAlert size={16} aria-hidden="true" />
                )}
                <span>{saveBanner.text}</span>
              </div>
            )}

            {/* Backward-compatible test-line + rich live progress trail */}
            <div
              className={"test-line" + (testSummaryClass ? " " + testSummaryClass : "")}
              data-testline=""
              aria-live="polite"
            >
              {testSummaryLine}
            </div>

            {(testing || testProgress.length > 0 || testResult?.attemptedModels?.length > 0) && (
              <div className="connection-trail-box">
                <div className="trail-header">
                  <strong>Verification Progress &amp; Attempt Trail</strong>
                  {testResult?.traceId && <code>trace:{testResult.traceId}</code>}
                </div>

                {testProgress.length > 0 && (
                  <ol className="progress-timeline">
                    {testProgress.map((evt, idx) => (
                      <li key={idx} className={"timeline-step stage-" + (evt.stage || "info")}>
                        <span className="timeline-dot" aria-hidden="true" />
                        <span>{evt.message}</span>
                      </li>
                    ))}
                  </ol>
                )}

                {Array.isArray(testResult?.attemptedModels) && testResult.attemptedModels.length > 0 && (
                  <div className="attempts-table-wrap">
                    <table className="attempts-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Try</th>
                          <th>Outcome</th>
                          <th>Latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testResult.attemptedModels.map((att, idx) => (
                          <tr key={idx}>
                            <td><code>{att.model}</code></td>
                            <td>#{att.attempt}</td>
                            <td>
                              <span className={"outcome-pill outcome-" + att.outcome}>
                                {att.outcome === "success"
                                  ? "200 OK"
                                  : `${att.statusCode ? att.statusCode + " " : ""}${att.classification}`}
                              </span>
                            </td>
                            <td>{(Number(att.elapsedMs || 0) / 1000).toFixed(2)}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!testResult?.ok && testResult?.guidanceUrl && (
                  <a
                    className="guidance-link"
                    href={testResult.guidanceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View official Gemini API troubleshooting &amp; quota guide →
                  </a>
                )}
              </div>
            )}
          </article>

          {/* Right Panel: Model Health & Capability Selection */}
          <article className="card gemini-health-card">
            <header className="gemini-card-head">
              <div>
                <span className="card-kind">DISCOVERY &amp; CAPABILITY ROUTING</span>
                <h2>Model Health &amp; Selection</h2>
              </div>
              <span className="catalog-pill">
                <Cpu size={14} aria-hidden="true" />
                <span>
                  {catalog.totalDiscovered > 0
                    ? `${catalog.totalDiscovered} models · ${formatRelativeTime(catalog.syncedAt) || "synced"}`
                    : "Catalog not synced yet"}
                </span>
              </span>
            </header>

            {catalog.error && (
              <div className="error-box error-box-compact" role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>{catalog.error}</span>
              </div>
            )}

            <div className="capability-stack">
              {CAPABILITY_META.map(({ key, field, label, desc }) => {
                const rankedList = catalog.ranked?.[key] || [];
                const ch = capHealth[key] || {};
                const [fieldVal, setFieldVal] = modelStateByField[field];
                const preferred =
                  selectionMode === "manual"
                    ? fieldVal
                    : rankedList[0]?.id || ch.preferredModel || fieldVal;
                const active =
                  selectionMode === "manual"
                    ? fieldVal
                    : ch.activeModel || preferred;

                const optionIds = Array.from(
                  new Set([
                    fieldVal,
                    ...rankedList.map((m) => m.id),
                  ].filter(Boolean)),
                );

                return (
                  <div key={key} className="capability-card">
                    <div className="capability-head">
                      <div>
                        <h3>{label}</h3>
                        <p className="capability-desc">{desc}</p>
                      </div>
                      <span className="step-badge badge-code">
                        {rankedList.length > 0 ? `${rankedList.length} eligible` : "Default"}
                      </span>
                    </div>

                    <div className="capability-metrics">
                      <div>
                        <span className="spec-k">Preferred (#1)</span>
                        <code>{preferred || "—"}</code>
                      </div>
                      <div>
                        <span className="spec-k">Active / Effective</span>
                        <code>{active || "—"}</code>
                      </div>
                      <div>
                        <span className="spec-k">Last Verified</span>
                        <span>
                          {ch.verifiedAt
                            ? `${ch.verifiedModel} (${formatRelativeTime(ch.verifiedAt)})`
                            : "Not verified yet"}
                        </span>
                      </div>
                    </div>

                    {ch.reason && (
                      <div className="cooldown-note">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>{ch.reason}</span>
                      </div>
                    )}

                    <label className="capability-select-label">
                      <span>
                        {selectionMode === "manual"
                          ? "Pinned manual model"
                          : "Fallback / manual default model"}
                      </span>
                      {rankedList.length > 0 ? (
                        <select
                          name={field}
                          data-field={field}
                          value={fieldVal}
                          onChange={(e) => setFieldVal(e.target.value)}
                        >
                          {optionIds.map((id) => {
                            const meta = rankedList.find((m) => m.id === id);
                            return (
                              <option key={id} value={id}>
                                {meta
                                  ? `#${meta.rank} ${meta.id} (${meta.tier}${meta.isPreview ? " · preview" : ""})`
                                  : `${id} (custom / saved)`}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <input
                          type="text"
                          name={field}
                          data-field={field}
                          value={fieldVal}
                          onChange={(e) => setFieldVal(e.target.value)}
                        />
                      )}
                    </label>
                  </div>
                );
              })}
            </div>

            {recentTrails.length > 0 && (
              <details className="recent-trails-details">
                <summary>Recent request fallback &amp; verification log ({recentTrails.length})</summary>
                <ul className="trail-log-list">
                  {recentTrails.map((t) => (
                    <li key={t.traceId}>
                      <span className={t.ok ? "log-ok" : "log-bad"}>
                        {t.ok ? "PASS" : "FAIL"}
                      </span>
                      <strong>{t.action}</strong>
                      <span>
                        {t.ok
                          ? t.downgraded
                            ? `${t.preferredModel} → ${t.effectiveModel}`
                            : t.effectiveModel
                          : t.reasonCategory}
                      </span>
                      <span className="log-time">{formatRelativeTime(t.at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        </form>

        <section className="other-providers-section" aria-labelledby="other-providers-heading">
          <div className="section-head">
            <div>
              <h2 id="other-providers-heading">Other Providers (Unintegrated Placeholders)</h2>
              <p className="section-sub">
                Kept for backward-compatible local key storage; active Studio features run exclusively on Google Gemini.
              </p>
            </div>
          </div>

          <div className="cards cards-three">
            {otherProviders.map(([name, cfg]) => (
              <UnintegratedProviderCard
                key={name + ":" + epoch}
                name={name}
                cfg={cfg}
                onSave={onSave}
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
