import {
  ArrowRight,
  AudioLines,
  CheckCircle2,
  Code2,
  Cpu,
  FileText,
  Film,
  ScanEye,
  Settings,
  Sliders,
} from "lucide-react";
import { POLICY_LABELS, formatRelativeTime } from "../lib/studio.mjs";

const PIPELINE_STEPS = [
  {
    step: "01",
    name: "Script",
    mode: "UI Active",
    modeClass: "badge-active",
    detail: "Gemini generates timed beats & word targets (/api/script).",
    targetPanel: "script",
    Icon: FileText,
  },
  {
    step: "02",
    name: "Voice / TTS",
    mode: "Backend API",
    modeClass: "badge-experimental",
    detail: "Experimental POST /api/tts wraps 24 kHz PCM into mono WAV.",
    targetPanel: "settings",
    Icon: AudioLines,
  },
  {
    step: "03",
    name: "Shot & Still QA",
    mode: "UI Active",
    modeClass: "badge-active",
    detail: "Gemini Vision checks frames for clipping & glitches (/api/check-still).",
    targetPanel: "still",
    Icon: ScanEye,
  },
  {
    step: "04",
    name: "3D Render",
    mode: "CLI Engine",
    modeClass: "badge-code",
    detail: "Pure code in engine/ (Remotion + Three.js, zero AI pixels).",
    targetPanel: null,
    Icon: Film,
  },
  {
    step: "05",
    name: "Mix & Loudness QA",
    mode: "CLI Pipeline",
    modeClass: "badge-code",
    detail: "Python numpy score/SFX synthesis + ffmpeg loudnorm in pipeline/.",
    targetPanel: null,
    Icon: Sliders,
  },
];

export default function DashboardPage({
  connection,
  providers,
  catalog,
  onNavigate,
}) {
  const gemini = providers?.gemini || {};
  const health = gemini.health || {};
  const caps = health.capabilities || {};
  const policyInfo = POLICY_LABELS[gemini.modelPolicy || "quality"] || POLICY_LABELS.quality;

  return (
    <section id="panel-dashboard" className="panel active" aria-labelledby="dashboard-heading">
      <div className="hero-banner">
        <div className="hero-content">
          <div className="eyebrow">AI WRITES &amp; VERIFIES · PURE CODE RENDERS</div>
          <h1 id="dashboard-heading">Out of Step Studio</h1>
          <p className="lede">
            Author timed narration scripts for any short-film topic and run vision QA on rendered stills, while keeping
            every pixel and audio sample deterministic in code.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => onNavigate("script")}
            >
              <FileText size={16} aria-hidden="true" />
              <span>Open Script Studio</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => onNavigate("still")}
            >
              <ScanEye size={16} aria-hidden="true" />
              <span>Run Still Check</span>
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onNavigate("settings")}
            >
              <Settings size={16} aria-hidden="true" />
              <span>{gemini.hasKey ? "Model & Routing Settings" : "Add Gemini API Key"}</span>
            </button>
          </div>
        </div>

        <aside className="hero-health-card" aria-label="Gemini routing summary">
          <div className="hero-health-head">
            <span className="card-kind">GEMINI ROUTING STATUS</span>
            <span className={connection.className}>{connection.text}</span>
          </div>
          <div className="health-kv-list">
            <div className="health-kv">
              <span>Mode &amp; Policy</span>
              <strong>
                {gemini.selectionMode === "manual" ? "Manual override" : `Auto · ${policyInfo.title}`}
              </strong>
            </div>
            <div className="health-kv">
              <span>Script (Text)</span>
              <code>{caps.text?.activeModel || gemini.textModel || "Not resolved"}</code>
            </div>
            <div className="health-kv">
              <span>Still QA (Vision)</span>
              <code>{caps.vision?.activeModel || gemini.visionModel || "Not resolved"}</code>
            </div>
            <div className="health-kv">
              <span>Catalog Sync</span>
              <span>
                {catalog.totalDiscovered > 0
                  ? `${catalog.totalDiscovered} models (${formatRelativeTime(catalog.syncedAt) || "synced"})`
                  : gemini.hasKey
                    ? "Pending discovery"
                    : "Save API key first"}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <section className="section-block" aria-labelledby="pipeline-heading">
        <div className="section-head">
          <div>
            <h2 id="pipeline-heading">Production Pipeline Architecture</h2>
            <p className="section-sub">
              Interactive steps open directly in Studio; deterministic render and mix steps run via repository CLI tools.
            </p>
          </div>
        </div>

        <ol className="pipeline-stepper">
          {PIPELINE_STEPS.map(({ step, name, mode, modeClass, detail, targetPanel, Icon }) => (
            <li key={step} className="pipeline-step">
              <div className="pipeline-step-top">
                <span className="step-num">{step}</span>
                <span className={"step-badge " + modeClass}>{mode}</span>
              </div>
              <div className="pipeline-step-title">
                <Icon size={17} aria-hidden="true" />
                <h3>{name}</h3>
              </div>
              <p className="pipeline-step-desc">{detail}</p>
              {targetPanel ? (
                <button
                  type="button"
                  className="text-link-btn"
                  onClick={() => onNavigate(targetPanel)}
                >
                  <span>Open {targetPanel === "settings" ? "Settings" : name}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <span className="cli-hint">
                  <Code2 size={13} aria-hidden="true" />
                  <span>CLI workflow only</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="section-block" aria-labelledby="modules-heading">
        <div className="section-head">
          <h2 id="modules-heading">Studio Capabilities</h2>
        </div>

        <div className="cards cards-four">
          <article className="card card-interactive">
            <div className="card-top">
              <span className="card-kind">AI · Gemini Text</span>
              <Cpu size={16} className="muted-icon" aria-hidden="true" />
            </div>
            <h3>Script</h3>
            <p className="card-status" id="status-script">
              Generates timed narration beats from any topic (30s or 60s target pacing at ~3.5 words/sec) with automatic
              503 overload fallback.
            </p>
            <div className="card-foot">
              <button type="button" className="secondary-btn btn-sm" onClick={() => onNavigate("script")}>
                Write script
              </button>
            </div>
          </article>

          <article className="card">
            <div className="card-top">
              <span className="card-kind">AI · Gemini · Experimental</span>
              <AudioLines size={16} className="muted-icon" aria-hidden="true" />
            </div>
            <h3>Voice / TTS</h3>
            <p className="card-status">
              Backend <code>POST /api/tts</code> synthesizes 24 kHz mono WAV audio using discovered TTS-capable models.
              Availability depends on your Google AI Studio account.
            </p>
            <div className="card-foot">
              <span className="meta-tag">
                {caps.tts?.eligibleCount
                  ? `${caps.tts.eligibleCount} TTS model(s) discovered`
                  : "Check TTS models in Settings"}
              </span>
            </div>
          </article>

          <article className="card card-interactive">
            <div className="card-top">
              <span className="card-kind">AI · Gemini Vision</span>
              <ScanEye size={16} className="muted-icon" aria-hidden="true" />
            </div>
            <h3>Still Check</h3>
            <p className="card-status" id="status-still">
              Vision QA on rendered frames: returns structured PASS / FAIL verdicts with specific framing or rendering
              issues.
            </p>
            <div className="card-foot">
              <button type="button" className="secondary-btn btn-sm" onClick={() => onNavigate("still")}>
                Inspect frame
              </button>
            </div>
          </article>

          <article className="card">
            <div className="card-top">
              <span className="card-kind">Code · Remotion Engine</span>
              <CheckCircle2 size={16} className="muted-icon" aria-hidden="true" />
            </div>
            <h3>Render &amp; Mix</h3>
            <p className="card-status">
              Three.js inside Remotion (<code>engine/</code>) and numpy synthesis (<code>pipeline/make_mix.py</code>).
              No AI in rendering — run <code>npx remotion studio src/index.ts</code> locally.
            </p>
            <div className="card-foot">
              <span className="meta-tag">Composition: CowboyShort · 1080×1920</span>
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
