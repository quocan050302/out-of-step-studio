import { useEffect, useRef, useState } from "react";
import {
  PROVIDER_LABELS,
  api,
  connectionStatus,
  readLastGeminiTest,
  scriptWordCount,
} from "./lib/studio.mjs";

function Dashboard({ connection }) {
  return (
    <section id="panel-dashboard" className="panel active">
      <header className="panel-head">
        <h1>Dashboard</h1>
        <span id="conn-pill" className={connection.className}>{connection.text}</span>
      </header>
      <p className="lede">One pipeline, two kinds of steps: AI steps run on Gemini, the render itself is pure code.</p>
      <div className="cards">
        <article className="card">
          <h2>Script</h2>
          <p className="card-kind">AI · Gemini</p>
          <p className="card-status" id="status-script">Generates timed narration beats from a topic.</p>
        </article>
        <article className="card">
          <h2>Voice / TTS</h2>
          <p className="card-kind">AI · Gemini · experimental</p>
          <p className="card-status">Text-to-speech via the Gemini TTS model. Availability depends on your account.</p>
        </article>
        <article className="card">
          <h2>Still Check</h2>
          <p className="card-kind">AI · Gemini vision</p>
          <p className="card-status" id="status-still">Vision QA on rendered frames: PASS / FAIL with issues.</p>
        </article>
        <article className="card">
          <h2>Render</h2>
          <p className="card-kind">Code · Remotion engine</p>
          <p className="card-status">three.js inside Remotion. No AI — every frame is drawn by code. See <code>engine/</code>.</p>
        </article>
      </div>
    </section>
  );
}

function ScriptPanel() {
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("30");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const out = await api("/api/script", {
        topic,
        durationSec: Number(duration),
      });
      if (!out.ok) {
        setError(out.error || "Generation failed");
      } else {
        setResult({ script: out.script, model: out.model });
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="panel-script" className="panel active">
      <header className="panel-head"><h1>Script</h1></header>
      <p className="lede">Gemini writes narration beats in the Out of Step style. From this server a call can take 1–3 minutes — please wait after clicking Generate.</p>
      <form id="script-form" className="form" onSubmit={handleSubmit}>
        <label>Topic
          <input id="script-topic" type="text" placeholder="a cowboy who learns to share" required value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label>Duration
          <select id="script-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="30">30 seconds</option>
            <option value="60">60 seconds</option>
          </select>
        </label>
        <button id="script-generate" className="primary-btn" type="submit" disabled={busy}>
          {busy ? "Generating… (can take 1–3 min)" : "Generate script"}
        </button>
      </form>
      <div id="script-result" className="result">
        {error && <div className="error-box">{error}</div>}
        {result && (
          <>
            <h2>{result.script.title || "Untitled"}</h2>
            <p className="note">{scriptWordCount(result.script)} words · model {result.model}</p>
            <ol className="beat-list">
              {result.script.beats.map((beat, index) => (
                <li key={index}>
                  <span className="beat-sec">{Number(beat.estSec || 0).toFixed(1)}s</span>
                  <br />
                  {beat.text}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function StillPanel() {
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState("");
  const imageData = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      imageData.current = {
        base64: url.split(",")[1],
        mimeType: file.type || "image/jpeg",
      };
      setPreview(url);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (!imageData.current) {
      setError("Choose an image first.");
      setResult(null);
      return;
    }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const out = await api("/api/check-still", {
        imageBase64: imageData.current.base64,
        mimeType: imageData.current.mimeType,
        shotNote: note,
      });
      if (!out.ok) {
        setError(out.error || "Check failed");
      } else {
        setResult(out.result || {});
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  const pass = result && String(result.verdict).toUpperCase() === "PASS";
  const issues = Array.isArray(result?.issues) ? result.issues : [];

  return (
    <section id="panel-still" className="panel active">
      <header className="panel-head"><h1>Still Check</h1></header>
      <p className="lede">Upload a rendered frame; Gemini vision returns a PASS / FAIL verdict with issues.</p>
      <form id="still-form" className="form" onSubmit={handleSubmit}>
        <label>Frame image
          <input id="still-file" type="file" accept="image/*" required onChange={handleFileChange} />
        </label>
        <img id="still-preview" className="still-preview" src={preview || undefined} alt="" hidden={!preview} />
        <label>Shot note (what should this frame show?)
          <input id="still-note" type="text" placeholder="front medium shot of the cowboy column marching in step" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button id="still-check" className="primary-btn" type="submit" disabled={busy}>
          {busy ? "Checking… (can take 1–3 min)" : "Check still"}
        </button>
      </form>
      <div id="still-result" className="result">
        {error && <div className="error-box">{error}</div>}
        {result && (
          <>
            <div className={"verdict " + (pass ? "verdict-pass" : "verdict-fail")}>{pass ? "PASS" : "FAIL"}</div>
            <p className="note">{result.summary || ""}</p>
            {issues.length > 0 && (
              <ul className="issue-list">
                {issues.map((issue, index) => <li key={index}>{issue}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ProviderCard({ name, cfg, onSave, onTest }) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testLine, setTestLine] = useState(null);
  const modelFields = [
    ["textModel", "Text model"],
    ["visionModel", "Vision model"],
    ["ttsModel", "TTS model (experimental)"],
  ];

  async function handleSave(event) {
    event.preventDefault();
    if (saving) return;
    const fields = {};
    for (const [field, value] of new FormData(event.currentTarget)) {
      if (field === "apiKey" && !value) continue; // blank = keep existing
      fields[field] = String(value);
    }
    setSaving(true);
    try {
      const out = await onSave(name, fields);
      if (!out.ok) setTestLine({ type: "bad", text: "Failed: " + (out.error || "unknown error") });
    } catch (err) {
      setTestLine({ type: "bad", text: "Failed: " + String(err.message || err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestLine({ type: "", text: "Testing… Gemini can take 1–3 minutes from this server." });
    try {
      const out = await api("/api/test-connection", { provider: "gemini" });
      if (out.ok) {
        setTestLine({
          type: "ok",
          text: "Connected — " + out.model + " replied \"" + out.reply + "\" in " + Math.round(out.latencyMs / 1000) + "s.",
        });
      } else {
        setTestLine({ type: "bad", text: "Failed: " + (out.error || "unknown error") });
      }
      onTest(Boolean(out.ok));
    } catch (err) {
      setTestLine({ type: "bad", text: "Failed: " + String(err.message || err) });
      onTest(false);
    } finally {
      setTesting(false);
    }
  }

  return (
    <article className="card">
      <h2>{PROVIDER_LABELS[name] || name}</h2>
      <p className="card-kind">{cfg.integrated ? "Integrated" : "Not integrated yet"}</p>
      <form className="form" data-provider={name} onSubmit={handleSave}>
        <label>API key
          <input type="password" data-field="apiKey" name="apiKey" autoComplete="off" placeholder={cfg.hasKey ? "Current: " + cfg.apiKey + " — type to replace" : "Paste API key"} />
        </label>
        {name === "gemini" && modelFields.map(([field, label]) => (
          <label key={field}>{label}
            <input type="text" data-field={field} name={field} defaultValue={cfg[field] || ""} />
          </label>
        ))}
        <div className="btn-row">
          <button className="primary-btn" type="submit" disabled={saving}>Save</button>
          {name === "gemini" && (
            <button className="secondary-btn" type="button" data-test="gemini" disabled={testing} onClick={handleTest}>Test connection</button>
          )}
        </div>
        <div className={"test-line" + (testLine?.type ? " " + testLine.type : "")} data-testline="">
          {testLine?.text || ""}
        </div>
      </form>
    </article>
  );
}

function SettingsPanel({ providers, epoch, onSave, onTest }) {
  return (
    <section id="panel-settings" className="panel active">
      <header className="panel-head"><h1>Settings</h1></header>
      <p className="lede">Keys are stored only in a local file on this machine and are never committed to GitHub.</p>
      <div id="provider-cards" className="cards cards-single">
        {Object.entries(providers || {}).map(([name, cfg]) => (
          <ProviderCard key={name + ":" + epoch} name={name} cfg={cfg} onSave={onSave} onTest={onTest} />
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [panel, setPanel] = useState("dashboard");
  const [theme, setTheme] = useState(() => localStorage.getItem("oos-theme") || "dark");
  const [providers, setProviders] = useState(null);
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const [lastTest, setLastTest] = useState(readLastGeminiTest);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("oos-theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    api("/api/settings")
      .then((out) => { if (mounted && out.ok) setProviders(out.providers); })
      .catch((err) => { if (mounted) console.error("Unable to load settings:", err); });
    return () => { mounted = false; };
  }, []);

  async function saveProvider(provider, fields) {
    const out = await api("/api/settings", { provider, fields });
    if (out.ok) {
      setProviders(out.providers);
      setSettingsEpoch((n) => n + 1); // Clear form inputs/test line, matching previous renderProviderCards().
    }
    return out;
  }

  function recordGeminiTest(ok) {
    const last = { ok, at: Date.now() };
    localStorage.setItem("oos-gemini-test", JSON.stringify(last));
    setLastTest(last);
  }

  const connection = connectionStatus(providers, lastTest);
  const navItems = [
    ["dashboard", "Dashboard"],
    ["script", "Script"],
    ["still", "Still Check"],
    ["settings", "Settings"],
  ];

  // Panels stay mounted while hidden, just like the original DOM implementation.
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OS</div>
          <div>
            <div className="brand-name">Out of Step</div>
            <div className="brand-sub">Cartoon Studio</div>
          </div>
        </div>
        <nav className="nav">
          {navItems.map(([id, title]) => (
            <button key={id} type="button" className={"nav-item" + (panel === id ? " active" : "")} data-panel={id} onClick={() => setPanel(id)}>
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button id="theme-toggle" className="ghost-btn" type="button" onClick={() => setTheme((prev) => prev === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>
      <main className="main">
        <div className={panel === "dashboard" ? "" : "panel-hidden"}><Dashboard connection={connection} /></div>
        <div className={panel === "script" ? "panel-host active" : "panel-host"}><ScriptPanel /></div>
        <div className={panel === "still" ? "panel-host active" : "panel-host"}><StillPanel /></div>
        <div className={panel === "settings" ? "panel-host active" : "panel-host"}>
          <SettingsPanel providers={providers} epoch={settingsEpoch} onSave={saveProvider} onTest={recordGeminiTest} />
        </div>
      </main>
    </div>
  );
}
