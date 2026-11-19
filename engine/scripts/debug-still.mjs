import fs from "node:fs";
if (process.env.REMOTION_TMP) { fs.mkdirSync(process.env.REMOTION_TMP, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.REMOTION_TMP; }
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const localShell = process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell";
const browserExecutable = fs.existsSync(localShell) ? localShell : undefined;
const chromiumOptions = { gl: "swangle", flags: { "enable-unsafe-swiftshader": true } };
const serveUrl = await bundle({ entryPoint: path.resolve("src/debug/Debug4.tsx"), publicDir: path.resolve("public") });
const composition = await selectComposition({ serveUrl, id: "DebugWorld", browserExecutable, chromiumOptions });
await renderStill({ composition, serveUrl, frame: Number(process.env.FRAME || 5), inputProps: process.env.MODE ? { mode: process.env.MODE } : {}, output: "../out/cowboy/stills/s2_.jpg", imageFormat: "jpeg", jpegQuality: 88, scale: 0.5, browserExecutable, chromiumOptions, timeoutInMilliseconds: 120000,
  onBrowserLog: (l) => console.log(`[${l.type}]`, l.text.slice(0, 400)) });
console.log("done");
