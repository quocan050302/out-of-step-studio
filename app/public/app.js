// Out of Step Studio — frontend logic. All AI calls go through our own
// backend (/api/*); API keys never reach the browser (settings come masked).

const $ = (sel) => document.querySelector(sel);

// ---------- Theme (dark default, persisted) ----------
const savedTheme = localStorage.getItem("oos-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
function syncThemeBtn() {
  $("#theme-toggle").textContent =
    document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode";
}
$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("oos-theme", next);
  syncThemeBtn();
});
syncThemeBtn();

// ---------- Nav ----------
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.toggle("active", p.id === "panel-" + btn.dataset.panel));
  });
});

// ---------- Settings ----------
const PROVIDER_LABELS = {
  gemini: "Google Gemini (AI Studio)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  elevenlabs: "ElevenLabs",
};
let providersCache = {};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function setConnPill(state, text) {
  const pill = $("#conn-pill");
  pill.className = "pill" + (state === "ok" ? " pill-ok" : state === "bad" ? " pill-bad" : "");
  pill.textContent = text;
}

function renderProviderCards() {
  const wrap = $("#provider-cards");
  wrap.innerHTML = "";
  for (const [name, cfg] of Object.entries(providersCache)) {
    const card = document.createElement("article");
    card.className = "card";
    const fields = [];
    fields.push(`
      <label>API key
        <input type="password" data-field="apiKey" autocomplete="off"
          placeholder="${cfg.hasKey ? "Current: " + cfg.apiKey + " — type to replace" : "Paste API key"}">
      </label>`);
    if (name === "gemini") {
      for (const f of ["textModel", "visionModel", "ttsModel"]) {
        const label = f === "textModel" ? "Text model" : f === "visionModel" ? "Vision model" : "TTS model (experimental)";
        fields.push(`<label>${label}<input type="text" data-field="${f}" value="${cfg[f] || ""}"></label>`);
      }
    }
    card.innerHTML = `
      <h2>${PROVIDER_LABELS[name] || name}</h2>
      <p class="card-kind">${cfg.integrated ? "Integrated" : "Not integrated yet"}</p>
      <form class="form" data-provider="${name}">${fields.join("")}
        <div class="btn-row">
          <button class="primary-btn" type="submit">Save</button>
          ${name === "gemini" ? '<button class="secondary-btn" type="button" data-test="gemini">Test connection</button>' : ""}
        </div>
        <div class="test-line" data-testline></div>
      </form>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const provider = form.dataset.provider;
      const fields = {};
      form.querySelectorAll("[data-field]").forEach((input) => {
        if (input.dataset.field === "apiKey" && !input.value) return; // blank = keep existing
        fields[input.dataset.field] = input.value;
      });
      const out = await api("/api/settings", { provider, fields });
      if (out.ok) {
        providersCache = out.providers;
        renderProviderCards();
        refreshConnPill();
      }
    });
  });
  const testBtn = wrap.querySelector('[data-test="gemini"]');
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const line = testBtn.closest("form").querySelector("[data-testline]");
      testBtn.disabled = true;
      line.className = "test-line";
      line.textContent = "Testing… Gemini can take 1–3 minutes from this server.";
      const out = await api("/api/test-connection", { provider: "gemini" });
      testBtn.disabled = false;
      if (out.ok) {
        line.className = "test-line ok";
        line.textContent = `Connected — ${out.model} replied "${out.reply}" in ${Math.round(out.latencyMs / 1000)}s.`;
        localStorage.setItem("oos-gemini-test", JSON.stringify({ ok: true, at: Date.now() }));
      } else {
        line.className = "test-line bad";
        line.textContent = "Failed: " + (out.error || "unknown error");
        localStorage.setItem("oos-gemini-test", JSON.stringify({ ok: false, at: Date.now() }));
      }
      refreshConnPill();
    });
  }
}

function refreshConnPill() {
  const g = providersCache.gemini || {};
  if (!g.hasKey) return setConnPill("", "Gemini: no key saved");
  let last = null;
  try { last = JSON.parse(localStorage.getItem("oos-gemini-test") || "null"); } catch { /* ignore */ }
  if (last?.ok) return setConnPill("ok", "Gemini: connected (last test OK)");
  if (last && !last.ok) return setConnPill("bad", "Gemini: last test failed");
  return setConnPill("", "Gemini: key saved, not tested");
}

async function loadSettings() {
  const out = await api("/api/settings");
  if (out.ok) {
    providersCache = out.providers;
    renderProviderCards();
    refreshConnPill();
  }
}

// ---------- Script ----------
$("#script-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#script-generate");
  const box = $("#script-result");
  btn.disabled = true;
  btn.textContent = "Generating… (can take 1–3 min)";
  box.innerHTML = "";
  const out = await api("/api/script", {
    topic: $("#script-topic").value,
    durationSec: Number($("#script-duration").value),
  });
  btn.disabled = false;
  btn.textContent = "Generate script";
  if (!out.ok) {
    box.innerHTML = `<div class="error-box">${escapeHtml(out.error || "Generation failed")}</div>`;
    return;
  }
  const s = out.script;
  const beats = s.beats.map((b) =>
    `<li><span class="beat-sec">${Number(b.estSec || 0).toFixed(1)}s</span><br>${escapeHtml(b.text)}</li>`).join("");
  box.innerHTML = `<h2>${escapeHtml(s.title || "Untitled")}</h2>
    <p class="note">${s.totalWords ?? s.beats.reduce((n, b) => n + String(b.text).split(/\s+/).length, 0)} words · model ${escapeHtml(out.model)}</p>
    <ol class="beat-list">${beats}</ol>`;
});

// ---------- Still Check ----------
let stillData = null;
$("#still-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result;
    stillData = { base64: String(url).split(",")[1], mimeType: file.type || "image/jpeg" };
    const img = $("#still-preview");
    img.src = url;
    img.hidden = false;
  };
  reader.readAsDataURL(file);
});
$("#still-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#still-check");
  const box = $("#still-result");
  if (!stillData) { box.innerHTML = `<div class="error-box">Choose an image first.</div>`; return; }
  btn.disabled = true;
  btn.textContent = "Checking… (can take 1–3 min)";
  box.innerHTML = "";
  const out = await api("/api/check-still", {
    imageBase64: stillData.base64,
    mimeType: stillData.mimeType,
    shotNote: $("#still-note").value,
  });
  btn.disabled = false;
  btn.textContent = "Check still";
  if (!out.ok) {
    box.innerHTML = `<div class="error-box">${escapeHtml(out.error || "Check failed")}</div>`;
    return;
  }
  const r = out.result || {};
  const pass = String(r.verdict).toUpperCase() === "PASS";
  const issues = Array.isArray(r.issues) && r.issues.length
    ? `<ul class="issue-list">${r.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
  box.innerHTML = `<div class="verdict ${pass ? "verdict-pass" : "verdict-fail"}">${pass ? "PASS" : "FAIL"}</div>
    <p class="note">${escapeHtml(r.summary || "")}</p>${issues}`;
});

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadSettings();
