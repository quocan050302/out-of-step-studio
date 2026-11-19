import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  RefreshCw,
  ScanEye,
  Settings,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useElapsedSeconds } from "../hooks/useGeminiStudio.js";
import {
  MAX_STILL_FILE_BYTES,
  api,
  formatBytes,
  validateImageFile,
} from "../lib/studio.mjs";

export default function StillCheckPage({ providers, onRefreshHealth, onOpenSettings }) {
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState("");
  const [fileMeta, setFileMeta] = useState(null);
  const [dimensions, setDimensions] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const imageData = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);
  const [error, setError] = useState(null);

  const elapsed = useElapsedSeconds(busy);
  const gemini = providers?.gemini || {};
  const visionHealth = gemini.health?.capabilities?.vision;

  function loadSelectedFile(file) {
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.ok) {
      imageData.current = null;
      setPreview("");
      setFileMeta(null);
      setDimensions(null);
      setResult(null);
      setError({ message: validation.error, reasonCategory: "validation" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      const commaIdx = url.indexOf(",");
      const base64 = commaIdx >= 0 ? url.slice(commaIdx + 1) : "";
      if (!base64) {
        setError({ message: "Could not decode image file.", reasonCategory: "validation" });
        return;
      }
      imageData.current = {
        base64,
        mimeType: file.type || "image/jpeg",
      };
      setPreview(url);
      setFileMeta({
        name: file.name,
        size: file.size,
        type: file.type || "image/jpeg",
      });
      setDimensions(null);
    };
    reader.onerror = () => {
      setError({ message: "Failed to read the selected image file.", reasonCategory: "validation" });
    };
    reader.readAsDataURL(file);
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) loadSelectedFile(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) loadSelectedFile(file);
  }

  function clearImage() {
    imageData.current = null;
    setPreview("");
    setFileMeta(null);
    setDimensions(null);
    setResult(null);
    setResultMeta(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function runStillCheck() {
    if (busy) return;
    if (!imageData.current) {
      setError({ message: "Choose an image first.", reasonCategory: "validation" });
      setResult(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setResult(null);
    setResultMeta(null);
    setError(null);

    try {
      const out = await api(
        "/api/check-still",
        {
          imageBase64: imageData.current.base64,
          mimeType: imageData.current.mimeType,
          shotNote: note,
        },
        { signal: controller.signal },
      );

      if (!out.ok) {
        setError({
          message: out.error || "Still QA check failed.",
          reasonCategory: out.reasonCategory || "failed",
        });
      } else {
        setResult(out.result || {});
        setResultMeta({
          model: out.actualModel || out.model,
          preferredModel: out.preferredModel || null,
          downgraded: Boolean(out.downgraded),
          latencyMs: out.latencyMs || null,
        });
        onRefreshHealth?.();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setError({ message: "Still check cancelled.", reasonCategory: "aborted" });
      } else {
        setError({ message: String(err?.message || err), reasonCategory: "network" });
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    runStillCheck();
  }

  const pass = result && String(result.verdict).toUpperCase() === "PASS";
  const issues = Array.isArray(result?.issues) ? result.issues : [];

  return (
    <section id="panel-still" className="panel active" aria-labelledby="still-heading">
      <div className="workspace-grid">
        <div className="workspace-side">
          <div className="card">
            <header className="panel-head">
              <div>
                <span className="card-kind">VISION QA UPLOADER</span>
                <h1 id="still-heading">Still Check</h1>
              </div>
            </header>
            <p className="lede">
              Upload a rendered frame (up to {formatBytes(MAX_STILL_FILE_BYTES)}); Gemini Vision checks composition,
              edge clipping, and rendering integrity.
            </p>

            <form id="still-form" className="form" onSubmit={handleSubmit} noValidate>
              <div
                className={
                  "dropzone" +
                  (dragActive ? " dropzone-active" : "") +
                  (preview ? " dropzone-has-preview" : "")
                }
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                }}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  id="still-file"
                  className="sr-file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                />

                {!preview ? (
                  <label htmlFor="still-file" className="dropzone-prompt">
                    <Upload size={24} className="dropzone-icon" aria-hidden="true" />
                    <strong>Drop a rendered frame here, or click to browse</strong>
                    <span>PNG, JPEG, WebP, or GIF · Max {formatBytes(MAX_STILL_FILE_BYTES)}</span>
                  </label>
                ) : (
                  <div className="preview-box">
                    <div className="preview-frame-wrap">
                      <img
                        id="still-preview"
                        className="still-preview"
                        src={preview}
                        alt={fileMeta?.name || "Uploaded frame preview"}
                        onLoad={(e) => {
                          setDimensions({
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                          });
                        }}
                      />
                    </div>
                    <div className="preview-meta">
                      <div className="preview-meta-text">
                        <strong title={fileMeta?.name}>{fileMeta?.name}</strong>
                        <span>
                          {formatBytes(fileMeta?.size)}
                          {dimensions ? ` · ${dimensions.w}×${dimensions.h}px` : ""}
                        </span>
                      </div>
                      <div className="preview-actions">
                        <label htmlFor="still-file" className="ghost-btn btn-sm">
                          <ImagePlus size={14} aria-hidden="true" />
                          <span>Replace</span>
                        </label>
                        <button
                          type="button"
                          className="ghost-btn btn-sm"
                          onClick={clearImage}
                          aria-label="Remove selected frame"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          <span>Clear</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {!preview && (
                  <img id="still-preview" className="still-preview" alt="" hidden />
                )}
              </div>

              <label htmlFor="still-note">
                <span>Shot intent (optional — what should this frame show?)</span>
                <input
                  id="still-note"
                  type="text"
                  placeholder="e.g. front medium shot of the column marching in step"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <div className="spec-summary">
                <div>
                  <span className="spec-k">Vision Model</span>
                  <code>{visionHealth?.activeModel || gemini.visionModel || "Auto"}</code>
                </div>
                <div>
                  <span className="spec-k">Client Limit</span>
                  <span>{formatBytes(MAX_STILL_FILE_BYTES)} raw (&lt;12 MB body)</span>
                </div>
              </div>

              <div className="btn-row">
                <button
                  id="still-check"
                  className="primary-btn"
                  type="submit"
                  disabled={busy}
                >
                  <ScanEye size={16} aria-hidden="true" />
                  <span>{busy ? "Checking frame…" : "Check still"}</span>
                </button>
                {busy && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <XCircle size={15} aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        <div className="workspace-main">
          <div id="still-result" className="result-surface" aria-live="polite">
            {busy && (
              <div className="loading-panel" role="status">
                <div className="progress-bar" aria-hidden="true">
                  <div className="progress-bar-fill" />
                </div>
                <div className="loading-copy">
                  <strong>Inspecting frame with Gemini Vision…</strong>
                  <span>Elapsed: {elapsed}s · Checking framing, clipping, and render artifacts.</span>
                </div>
              </div>
            )}

            {error && !busy && (
              <div className="error-box" role="alert">
                <div className="error-box-head">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <strong>
                    {error.reasonCategory === "validation" ? "Invalid image selection" : "Still QA check failed"}
                  </strong>
                </div>
                <p className="error-box-msg">{error.message}</p>
                <div className="btn-row">
                  {imageData.current && error.reasonCategory !== "validation" && (
                    <button type="button" className="secondary-btn btn-sm" onClick={runStillCheck}>
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>Retry check</span>
                    </button>
                  )}
                  {(error.reasonCategory === "no_key" ||
                    error.reasonCategory === "auth" ||
                    error.reasonCategory === "permission" ||
                    error.reasonCategory === "quota_global") && (
                    <button type="button" className="ghost-btn btn-sm" onClick={onOpenSettings}>
                      <Settings size={14} aria-hidden="true" />
                      <span>Open Settings</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {result && !busy && (
              <div className="verdict-card">
                {resultMeta?.downgraded && (
                  <div className="fallback-banner" role="status">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <div>
                      <strong>Model changed due to overload</strong>
                      <span>
                        {" "}
                        — Preferred <code>{resultMeta.preferredModel}</code> fell back to{" "}
                        <code>{resultMeta.model}</code>.
                      </span>
                    </div>
                  </div>
                )}

                <div className={"verdict-banner " + (pass ? "verdict-banner-pass" : "verdict-banner-fail")}>
                  <div className="verdict-badge-row">
                    {pass ? (
                      <CheckCircle2 size={24} aria-hidden="true" />
                    ) : (
                      <AlertTriangle size={24} aria-hidden="true" />
                    )}
                    <div className={"verdict " + (pass ? "verdict-pass" : "verdict-fail")}>
                      {pass ? "PASS" : "FAIL"}
                    </div>
                  </div>
                  {resultMeta?.model && (
                    <span className="verdict-model">
                      Checked by <code>{resultMeta.model}</code>
                      {resultMeta.latencyMs ? ` · ${(resultMeta.latencyMs / 1000).toFixed(1)}s` : ""}
                    </span>
                  )}
                </div>

                <p className="verdict-summary">{result.summary || "No summary returned."}</p>

                <div className="issues-section">
                  <h3>Detected Issues ({issues.length})</h3>
                  {issues.length > 0 ? (
                    <ul className="issue-list">
                      {issues.map((issue, index) => (
                        <li key={index} className="issue-item">
                          <AlertTriangle size={15} aria-hidden="true" />
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="no-issues-note">
                      No clipping, blank regions, or composition issues were flagged on this frame.
                    </p>
                  )}
                </div>
              </div>
            )}

            {!busy && !error && !result && (
              <div className="empty-state">
                <ScanEye size={28} className="empty-icon" aria-hidden="true" />
                <h2>Frame QA Verdict Inspector</h2>
                <p>
                  Drop a rendered still frame on the left (e.g. from <code>node scripts/bridge-stills.mjs</code>) and add
                  an optional shot note to verify readability, camera framing, and WebGL postprocessing output.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
