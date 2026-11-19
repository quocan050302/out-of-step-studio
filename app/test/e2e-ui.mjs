import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import { createServer as createViteServer } from "vite";
import { createStudioServer } from "../server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");

const BROWSER_CANDIDATES = [
  process.env.BROWSER_EXE,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

function findBrowserExecutable() {
  return BROWSER_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

// Minimal valid 36x64 (9:16) RGB PNG generator with zero external image libraries
function makeVerticalPngBuffer(width = 36, height = 64) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = 19;
      raw[px + 1] = 42 + Math.round((y / height) * 80);
      raw[px + 2] = 78 + Math.round((x / width) * 60);
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const MOCK_CATALOG = [
  {
    name: "models/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash Lite",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.8-flash-tts",
    displayName: "Gemini 3.8 Flash TTS",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
];

function createMockFetch() {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/models")) {
      return new Response(JSON.stringify({ models: MOCK_CATALOG }), { status: 200 });
    }
    const model = decodeURIComponent(/\/models\/([^:]+):generateContent/.exec(u.pathname)?.[1] || "");
    const body = JSON.parse(init.body || "{}");
    if (model === "gemini-2.5-pro") {
      return new Response(
        JSON.stringify({
          error: {
            code: 503,
            status: "UNAVAILABLE",
            message: "This model is currently experiencing high demand",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }

    const promptText = body.contents?.[0]?.parts?.[0]?.text || "";
    if (promptText.includes("Reply with exactly: OK")) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (promptText.includes("visual QA checker")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      verdict: "FAIL",
                      issues: [
                        "Foreground character brim slightly touches the left safe-frame margin.",
                        "Distant tower contrast is low against cloud layer.",
                      ],
                      summary: "Readable cowboy column on bridge, minor left-edge framing clip.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: "The Singing Suspension Span",
                    totalWords: 64,
                    beats: [
                      { text: "Twelve riders crossed the river planks in tidy two-by-two rhythm.", estSec: 3.6 },
                      { text: "By the third bar, the timber deck answered every boot tap.", estSec: 3.4 },
                      { text: "Iron chains hummed like a bass fiddle over the water.", estSec: 3.2 },
                      { text: "Eli called a halt, tipped his hat, and told everyone to stroll.", estSec: 3.8 },
                      { text: "Out of step, the bridge went quiet at once.", estSec: 3.1 },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function main() {
  const browserExe = findBrowserExecutable();
  if (!browserExe) {
    console.log("SKIP e2e-ui: No local Chrome/Edge/Chromium binary found.");
    process.exit(0);
  }

  const outShotsDir = process.env.SCREENSHOT_DIR
    ? path.resolve(process.env.SCREENSHOT_DIR)
    : path.resolve(APP_DIR, "../docs/executions/OOS-UI-02-2026-11-19/screenshots/after");
  const artDir = path.resolve(APP_DIR, "../docs/executions/OOS-UI-02-2026-11-19/test-artifacts");
  fs.mkdirSync(outShotsDir, { recursive: true });
  fs.mkdirSync(artDir, { recursive: true });

  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oos-e2e-data-"));
  const studio = createStudioServer({
    appDir: APP_DIR,
    dataDir: tempDataDir,
    fetchImpl: createMockFetch(),
    baseRetryDelayMs: 25,
    maxRetryDelayMs: 60,
  });

  await new Promise((resolve) => studio.server.listen(0, "127.0.0.1", resolve));
  const apiPort = studio.server.address().port;
  const prodUrl = `http://127.0.0.1:${apiPort}`;

  const vite = await createViteServer({
    root: APP_DIR,
    configFile: false,
    plugins: [react()],
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
      proxy: {
        "/api": { target: prodUrl, changeOrigin: true },
      },
    },
    logLevel: "error",
  });
  await vite.listen();
  const vitePort = vite.httpServer.address().port;
  const devUrl = `http://127.0.0.1:${vitePort}`;

  const browser = await chromium.launch({ executablePath: browserExe, headless: true });
  const consoleErrors = [];
  const pageErrors = [];
  const widthChecks = [];

  try {
    // 1. Verify BOTH dev Vite server and production built server serve UI cleanly
    {
      const prodCheckCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const prodPage = await prodCheckCtx.newPage();
      await prodPage.goto(prodUrl, { waitUntil: "networkidle" });
      assert.equal(await prodPage.title(), "Out of Step — Studio");
      const heroTitle = await prodPage.locator("#dashboard-heading").textContent();
      assert.equal(heroTitle, "Out of Step Studio");
      await prodCheckCtx.close();
    }

    // 2. Full Desktop E2E flow on Vite dev server (1650x960)
    const context = await browser.newContext({ viewport: { width: 1650, height: 960 } });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.goto(devUrl, { waitUntil: "networkidle" });

    // Check desktop layout occupancy (.main >= 1280px at 1650px viewport)
    const mainBox = await page.locator(".main").boundingBox();
    assert.ok(mainBox.width >= 1280, `Expected .main width >= 1280px at 1650px, got ${mainBox.width}`);

    // Navigate to Settings -> save synthetic demo key -> verify masking & blank preservation
    await page.click('[data-panel="settings"]');
    const syntheticKey = "AIzaSyntheticPlaywrightKey00099";
    await page.fill("#gemini-api-key", syntheticKey);
    await page.click('form[data-provider="gemini"] button[type="submit"]');
    await page.waitForSelector(".saved-key-pill");
    const pillText = await page.locator(".saved-key-pill").textContent();
    assert.match(pillText, /••••••••00099/);
    const fullDom = await page.content();
    assert.ok(!fullDom.includes(syntheticKey), "Full API key must never appear in DOM");

    // Save again with blank key -> existing key preserved
    await page.click('form[data-provider="gemini"] button[type="submit"]');
    await page.waitForSelector(".status-callout.ok");
    assert.match(await page.locator(".saved-key-pill").textContent(), /••••••••00099/);

    // Discover models & run Test Connection (Pro 503 -> Flash fallback)
    await page.click('[data-discover="gemini"]');
    await page.waitForFunction(() =>
      document.querySelector(".catalog-pill")?.textContent?.includes("4 models"),
    );

    await page.click('[data-test="gemini"]');
    await page.waitForSelector(".test-line.warn");
    const testLine = await page.locator("[data-testline]").textContent();
    assert.match(testLine, /Connected via fallback gemini-3\.8-flash/);
    assert.match(await page.locator("#conn-pill").textContent(), /fallback/);

    await page.screenshot({
      path: path.join(outShotsDir, "desktop-1650-settings.png"),
      fullPage: true,
    });

    // Dashboard screenshot with verified fallback health
    await page.click('[data-panel="dashboard"]');
    await page.screenshot({
      path: path.join(outShotsDir, "desktop-1650-dashboard.png"),
      fullPage: true,
    });

    // Script generation + fallback banner + Copy Script + tab state persistence
    await page.click('[data-panel="script"]');
    await page.fill("#script-topic", "How suspension bridges hum in rhythm");
    await page.click("#script-generate");
    await page.waitForSelector(".script-output-card");
    assert.match(
      await page.locator(".script-output-card").textContent(),
      /Model changed due to overload/,
    );
    assert.equal(await page.locator(".beat-card").count(), 5);

    await page.click('[data-action="copy-script"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-action="copy-script"]')?.textContent?.includes("Copied!"),
    );

    await page.screenshot({
      path: path.join(outShotsDir, "desktop-1650-script.png"),
      fullPage: true,
    });

    // Still Check: test oversized file rejection, then valid 9:16 PNG upload + QA check
    await page.click('[data-panel="still"]');
    const oversizedBuffer = Buffer.alloc(9 * 1024 * 1024, 0xaa);
    await page.setInputFiles("#still-file", {
      name: "huge-uncompressed.png",
      mimeType: "image/png",
      buffer: oversizedBuffer,
    });
    await page.waitForSelector("#still-result .error-box");
    assert.match(await page.locator("#still-result .error-box").textContent(), /exceeds the/i);

    const validPng = makeVerticalPngBuffer(54, 96);
    await page.setInputFiles("#still-file", {
      name: "s_200_bridge_column.png",
      mimeType: "image/png",
      buffer: validPng,
    });
    await page.waitForSelector(".preview-box");
    await page.fill("#still-note", "front medium shot of the cowboy column marching");
    await page.click("#still-check");
    await page.waitForSelector(".verdict-card");
    assert.equal(await page.locator(".verdict").textContent(), "FAIL");
    assert.equal(await page.locator(".issue-item").count(), 2);

    await page.screenshot({
      path: path.join(outShotsDir, "desktop-1650-still.png"),
      fullPage: true,
    });

    // Switch back to Script -> verify topic & 5 generated beats survived tab navigation!
    await page.click('[data-panel="script"]');
    assert.equal(await page.inputValue("#script-topic"), "How suspension bridges hum in rhythm");
    assert.equal(await page.locator(".beat-card").count(), 5);

    // WCAG contrast check & theme persistence across reload
    const computeContrast = async () =>
      page.evaluate(() => {
        function parseRgb(str) {
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
        }
        function lum([r, g, b]) {
          const f = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        }
        function ratio(c1, c2) {
          const l1 = lum(parseRgb(c1));
          const l2 = lum(parseRgb(c2));
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        }
        const bodyStyle = getComputedStyle(document.body);
        const btn = document.querySelector(".primary-btn");
        const btnStyle = getComputedStyle(btn);
        return {
          bodyContrast: Number(ratio(bodyStyle.color, bodyStyle.backgroundColor).toFixed(2)),
          ctaContrast: Number(ratio(btnStyle.color, btnStyle.backgroundColor).toFixed(2)),
        };
      });

    const darkContrast = await computeContrast();
    assert.ok(darkContrast.bodyContrast >= 12, `Dark body contrast too low: ${darkContrast.bodyContrast}`);
    assert.ok(darkContrast.ctaContrast >= 7, `Dark CTA contrast too low: ${darkContrast.ctaContrast}`);

    // Toggle to Light mode, reload, assert persisted, capture screenshot
    await page.click("#theme-toggle");
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    const lightContrast = await computeContrast();
    assert.ok(lightContrast.bodyContrast >= 10, `Light body contrast too low: ${lightContrast.bodyContrast}`);
    assert.ok(lightContrast.ctaContrast >= 4.5, `Light CTA contrast too low: ${lightContrast.ctaContrast}`);

    await page.click('[data-panel="settings"]');
    await page.screenshot({
      path: path.join(outShotsDir, "desktop-1650-settings-light.png"),
      fullPage: true,
    });

    // Switch back to Dark mode
    await page.click("#theme-toggle");
    assert.equal(await page.getAttribute("html", "data-theme"), "dark");

    // Keyboard focus check
    await page.keyboard.press("Tab");
    const hasFocusOutline = await page.evaluate(() => {
      const el = document.activeElement;
      return Boolean(el && el !== document.body);
    });
    assert.equal(hasFocusOutline, true);

    // 3. Responsive Matrix across all 9 mandatory widths (zero horizontal overflow + mobile UX)
    const REQUIRED_WIDTHS = [320, 375, 390, 430, 768, 1024, 1440, 1650, 1920];
    for (const width of REQUIRED_WIDTHS) {
      const height = width <= 768 ? 844 : 960;
      await page.setViewportSize({ width, height });

      for (const tab of ["dashboard", "script", "still", "settings"]) {
        if (width <= 768) {
          await page.click(`[data-mobile-panel="${tab}"]`);
        } else {
          await page.click(`[data-panel="${tab}"]`);
        }
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        assert.ok(
          metrics.scrollWidth <= metrics.innerWidth,
          `Horizontal overflow at ${width}px on ${tab}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
        );
        widthChecks.push({ width, tab, overflow: false });
      }

      if (width === 390) {
        // Test mobile slide-over drawer open + Escape close + touch target >=44px
        await page.click('button[aria-label="Open navigation menu"]');
        await page.waitForSelector(".sidebar.sidebar-mobile-open");
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => !document.querySelector(".sidebar")?.classList.contains("sidebar-mobile-open"),
        );

        const btnHeight = await page.locator(".panel-host.active .primary-btn").first().boundingBox();
        assert.ok(btnHeight && btnHeight.height >= 44, `Mobile touch target < 44px: ${btnHeight?.height}`);

        await page.click('[data-mobile-panel="dashboard"]');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outShotsDir, "mobile-390-dashboard.png") });
        await page.click('[data-mobile-panel="script"]');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outShotsDir, "mobile-390-script.png") });
        await page.click('[data-mobile-panel="still"]');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outShotsDir, "mobile-390-still.png") });
        await page.click('[data-mobile-panel="settings"]');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outShotsDir, "mobile-390-settings.png") });
      }

      if (width === 320) {
        await page.click('[data-mobile-panel="settings"]');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outShotsDir, "mobile-320-settings.png") });
      }
    }

    assert.deepEqual(consoleErrors, [], `Unexpected console errors: ${consoleErrors.join("; ")}`);
    assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join("; ")}`);

    fs.writeFileSync(
      path.join(artDir, "e2e-report.json"),
      JSON.stringify(
        {
          executedAt: new Date().toISOString(),
          browserExecutable: path.basename(browserExe),
          devServerVerified: true,
          prodServerVerified: true,
          desktopMainWidthAt1650: mainBox.width,
          darkContrast,
          lightContrast,
          widthsVerified: REQUIRED_WIDTHS,
          totalViewportTabAssertions: widthChecks.length,
          consoleErrors: consoleErrors.length,
          pageErrors: pageErrors.length,
          screenshots: fs.readdirSync(outShotsDir).sort(),
        },
        null,
        2,
      ),
    );

    await context.close();
    console.log(
      `PASS e2e-ui: ${widthChecks.length} viewport/tab checks, 0 console errors, ${fs.readdirSync(outShotsDir).length} screenshots saved.`,
    );
  } finally {
    await browser.close();
    await vite.close();
    await new Promise((resolve) => studio.server.close(resolve));
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("FAIL e2e-ui:", err);
  process.exit(1);
});
