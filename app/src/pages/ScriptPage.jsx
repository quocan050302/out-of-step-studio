import { useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  FileText,
  RefreshCw,
  Settings,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useElapsedSeconds } from "../hooks/useGeminiStudio.js";
import {
  api,
  formatScriptForClipboard,
  scriptTotalSeconds,
  scriptWordCount,
} from "../lib/studio.mjs";

const EXAMPLE_TOPICS = [
  "Why soldiers break step on suspension bridges",
  "How two pendulum clocks on the same wall sync up",
  "Why lighthouse beams each flash a unique signature",
];

export default function ScriptPage({ providers, onRefreshHealth, onOpenSettings }) {
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("30");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef(null);
  const elapsed = useElapsedSeconds(busy);

  const gemini = providers?.gemini || {};
  const textHealth = gemini.health?.capabilities?.text;
  const targetWords = Math.round(Number(duration) * 3.5);
  const targetBeats = Number(duration) <= 30 ? 9 : 16;

  async function runGeneration(currentTopic, currentDuration) {
    const trimmed = String(currentTopic || "").trim();
    if (!trimmed || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setCopied(false);

    try {
      const out = await api(
        "/api/script",
        {
          topic: trimmed,
          durationSec: Number(currentDuration),
        },
        { signal: controller.signal },
      );

      if (!out.ok) {
        setError({
          message: out.error || "Script generation failed.",
          reasonCategory: out.reasonCategory || "failed",
          attemptedModels: out.attemptedModels || [],
        });
      } else {
        setResult({
          script: out.script,
          model: out.actualModel || out.model,
          preferredModel: out.preferredModel || null,
          downgraded: Boolean(out.downgraded),
          reason: out.reason || null,
          warning: out.warning || null,
          latencyMs: out.latencyMs || null,
        });
        onRefreshHealth?.();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setError({
          message: "Script generation cancelled.",
          reasonCategory: "aborted",
        });
      } else {
        setError({
          message: String(err?.message || err),
          reasonCategory: "network",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    runGeneration(topic, duration);
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleCopy() {
    if (!result?.script) return;
    const text = formatScriptForClipboard(result.script, result.model);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }

  let runningSec = 0;

  return (
    <section id="panel-script" className="panel active" aria-labelledby="script-heading">
      <div className="workspace-grid">
        <div className="workspace-side">
          <div className="card">
            <header className="panel-head">
              <div>
                <span className="card-kind">NARRATION COMPOSER</span>
                <h1 id="script-heading">Script</h1>
              </div>
            </header>
            <p className="lede">
              Write timed deadpan story narration on any topic. Prompts follow the 9:16 short beat structure without
              captions.
            </p>

            <form id="script-form" className="form" onSubmit={handleSubmit}>
              <label htmlFor="script-topic">
                <span>Story Topic</span>
                <input
                  id="script-topic"
                  type="text"
                  placeholder="e.g. a curious true lesson or everyday phenomenon"
                  required
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </label>

              <div className="topic-chips" aria-label="Example story topics">
                <span className="chips-label">Try an example:</span>
                <div className="chips-wrap">
                  {EXAMPLE_TOPICS.map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      className="chip-btn"
                      onClick={() => setTopic(sample)}
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>

              <label htmlFor="script-duration">
                <span>Target Duration</span>
                <select
                  id="script-duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                >
                  <option value="30">30 seconds (~105 words · 9 beats)</option>
                  <option value="60">60 seconds (~210 words · 16 beats)</option>
                </select>
              </label>

              <div className="spec-summary">
                <div>
                  <span className="spec-k">Pacing</span>
                  <strong>~{targetWords} words · {targetBeats} beats</strong>
                </div>
                <div>
                  <span className="spec-k">Text Model</span>
                  <code>{textHealth?.activeModel || gemini.textModel || "Auto"}</code>
                </div>
              </div>

              <div className="btn-row">
                <button
                  id="script-generate"
                  className="primary-btn"
                  type="submit"
                  disabled={busy || !topic.trim()}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  <span>{busy ? "Generating script…" : "Generate script"}</span>
                </button>
                {busy && (
                  <button type="button" className="secondary-btn" onClick={handleCancel}>
                    <XCircle size={15} aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        <div className="workspace-main">
          <div id="script-result" className="result-surface" aria-live="polite">
            {busy && (
              <div className="loading-panel" role="status">
                <div className="progress-bar" aria-hidden="true">
                  <div className="progress-bar-fill" />
                </div>
                <div className="loading-copy">
                  <strong>Waiting for Gemini API response…</strong>
                  <span>
                    Elapsed: {elapsed}s · Automatic 503 retry &amp; fallback active if preferred model is overloaded.
                  </span>
                </div>
              </div>
            )}

            {error && !busy && (
              <div className="error-box" role="alert">
                <div className="error-box-head">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <strong>Script generation did not complete</strong>
                </div>
                <p className="error-box-msg">{error.message}</p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="secondary-btn btn-sm"
                    onClick={() => runGeneration(topic, duration)}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>Retry generation</span>
                  </button>
                  {(error.reasonCategory === "no_key" ||
                    error.reasonCategory === "auth" ||
                    error.reasonCategory === "permission" ||
                    error.reasonCategory === "quota_global") && (
                    <button
                      type="button"
                      className="ghost-btn btn-sm"
                      onClick={onOpenSettings}
                    >
                      <Settings size={14} aria-hidden="true" />
                      <span>Open Settings</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {result && !busy && (
              <div className="script-output-card">
                {result.downgraded && (
                  <div className="fallback-banner" role="status">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <div>
                      <strong>Model changed due to overload</strong>
                      <span>
                        {" "}
                        — Preferred <code>{result.preferredModel}</code> was unavailable; generated cleanly with{" "}
                        <code>{result.model}</code>.
                      </span>
                    </div>
                  </div>
                )}

                <header className="script-output-head">
                  <div>
                    <span className="card-kind">GENERATED NARRATION</span>
                    <h2>{result.script.title || "Untitled"}</h2>
                    <p className="note">
                      {scriptWordCount(result.script)} words · {scriptTotalSeconds(result.script).toFixed(1)}s est. ·{" "}
                      {result.script.beats.length} beats · model <code>{result.model}</code>
                      {result.latencyMs ? ` · ${(result.latencyMs / 1000).toFixed(1)}s` : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="secondary-btn btn-sm"
                    data-action="copy-script"
                    onClick={handleCopy}
                  >
                    {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    <span>{copied ? "Copied!" : "Copy script"}</span>
                  </button>
                </header>

                <ol className="beat-list">
                  {result.script.beats.map((beat, index) => {
                    const dur = Number(beat.estSec || 0);
                    const startSec = runningSec;
                    runningSec += dur;
                    return (
                      <li key={index} className="beat-card">
                        <div className="beat-meta">
                          <span className="beat-index">Beat {String(index + 1).padStart(2, "0")}</span>
                          <span className="beat-window">
                            <Clock size={12} aria-hidden="true" />
                            <span>
                              {startSec.toFixed(1)}s – {runningSec.toFixed(1)}s
                            </span>
                          </span>
                          <span className="beat-sec">{dur.toFixed(1)}s</span>
                        </div>
                        <p className="beat-text">{beat.text}</p>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {!busy && !error && !result && (
              <div className="empty-state">
                <FileText size={28} className="empty-icon" aria-hidden="true" />
                <h2>Ready to write timed beats</h2>
                <p>
                  Enter any story topic on the left and click <strong>Generate script</strong>. Output includes beat-by-beat
                  timings, total word count, active Gemini model attribution, and one-click clipboard export.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
