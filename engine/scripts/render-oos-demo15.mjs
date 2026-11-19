#!/usr/bin/env node
// Portable production render & QA launcher for OOSDemo15:
// "The Roman Messenger Who Lost His Scroll" (450 frames @ 30fps = 15.000s, 1080x1920 vertical 9:16).
// Usage: node scripts/render-oos-demo15.mjs [--stills-only]

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { buildShotPlanJson } from "../src/videos/demo15/story.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ENGINE_DIR, "..");
const OUT_DIR = path.resolve(REPO_ROOT, "out/oos-03/demo15");
const STILLS_DIR = path.join(OUT_DIR, "stills");
const QA_DIR = path.join(OUT_DIR, "qa");
const TRACKED_TMP_DIR = path.resolve(REPO_ROOT, `out/oos-03/.tmp-remotion-${process.pid}`);

const stillsOnly = process.argv.includes("--stills-only");

const BROWSER_CANDIDATES = [
  process.env.BROWSER_EXE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  `${os.homedir()}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

function findBrowserExecutable() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function checkDiskPreflight(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const dfOut = execFileSync("df", ["-Pk", targetDir], { encoding: "utf8" });
  const lines = dfOut.trim().split("\n");
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  const availKb = Number(cols[3] || 0);
  const availMb = Math.round(availKb / 1024);
  const projectedTempMb = 200;
  const requiredMb = projectedTempMb * 2 + 1024; // >= 2x projected temp + 1GB safety margin
  console.log(`[Preflight] Free disk: ${availMb} MB (required >= ${requiredMb} MB)`);
  if (availMb < requiredMb) {
    throw new Error(
      `BLOCKED: Insufficient free disk space (${availMb} MB available, need >= ${requiredMb} MB).\n${dfOut}`,
    );
  }
  return { availMb, requiredMb, dfOut: dfOut.trim() };
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function muxAudioWithVideo(rawVideoPath, wavPath, finalMp4Path) {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      rawVideoPath,
      "-i",
      wavPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-shortest",
      finalMp4Path,
    ],
    { stdio: "inherit" },
  );
}

function probeVideo(mp4Path) {
  const raw = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "stream=index,codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,sample_rate,channels,pix_fmt:format=filename,nb_streams,format_name,duration,size,bit_rate",
      "-of",
      "json",
      mp4Path,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(raw);
}

async function main() {
  const tStart = Date.now();
  const browserExecutable = findBrowserExecutable();
  if (!browserExecutable) {
    console.error("FAIL render-oos-demo15: No Chrome/Chromium/Edge binary found. Set BROWSER_EXE.");
    process.exit(1);
  }
  console.log(`[Render] Using browser executable: ${browserExecutable}`);

  const diskInfo = checkDiskPreflight(REPO_ROOT);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(STILLS_DIR, { recursive: true });
  fs.mkdirSync(QA_DIR, { recursive: true });
  fs.mkdirSync(TRACKED_TMP_DIR, { recursive: true });

  process.env.REMOTION_TMP = TRACKED_TMP_DIR;
  process.env.TMPDIR = TRACKED_TMP_DIR;
  process.env.TEMP = TRACKED_TMP_DIR;
  process.env.TMP = TRACKED_TMP_DIR;

  try {
    // 1. Write shot-plan.json
    const shotPlanPath = path.join(OUT_DIR, "shot-plan.json");
    const shotPlan = buildShotPlanJson();
    fs.writeFileSync(shotPlanPath, JSON.stringify(shotPlan, null, 2));
    console.log(`[1/6] Wrote shot plan -> ${shotPlanPath}`);

    // 2. Synthesize 15.000s 48 kHz stereo score + Foley SFX WAV
    const wavOutPath = path.join(OUT_DIR, "demo15-mix.wav");
    const publicWavPath = path.join(ENGINE_DIR, "public/demo15-mix.wav");
    execFileSync(
      "python3",
      [path.join(ENGINE_DIR, "scripts/synth_demo15_audio.py"), wavOutPath, publicWavPath],
      { stdio: "inherit" },
    );
    console.log(`[2/6] Synthesized audio track -> ${wavOutPath}`);

    // 3. Bundle Remotion entrypoint once
    console.log("[3/6] Bundling Remotion entrypoint (src/index.ts)...");
    const serveUrl = await bundle({
      entryPoint: path.join(ENGINE_DIR, "src/index.ts"),
      publicDir: path.join(ENGINE_DIR, "public"),
    });

    const chromiumOptions = {
      gl: process.env.GL || "angle",
    };

    const composition = await selectComposition({
      serveUrl,
      id: "OOSDemo15",
      browserExecutable,
      chromiumOptions,
    });
    console.log(
      `[3/6] Selected composition: ${composition.id} (${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames)`,
    );

    // 4. Render 15 diagnostic & QA stills spanning all 5 shots and key transitions
    const REPRESENTATIVE_FRAMES = [0, 14, 35, 60, 105, 150, 180, 215, 255, 270, 300, 350, 390, 415, 440];
    console.log(`[4/6] Rendering ${REPRESENTATIVE_FRAMES.length} diagnostic & QA stills (1080x1920)...`);
    for (const f of REPRESENTATIVE_FRAMES) {
      const stillPath = path.join(STILLS_DIR, `frame_${String(f).padStart(4, "0")}.png`);
      await renderStill({
        composition,
        serveUrl,
        frame: f,
        output: stillPath,
        imageFormat: "png",
        scale: 1,
        browserExecutable,
        chromiumOptions,
        timeoutInMilliseconds: 120_000,
      });
      const stat = fs.statSync(stillPath);
      if (stat.size < 5_000) {
        throw new Error(`Diagnostic still ${stillPath} is unexpectedly small (${stat.size} bytes).`);
      }
    }
    console.log(`[4/6] Verified ${REPRESENTATIVE_FRAMES.length} stills in ${STILLS_DIR}`);

    if (stillsOnly) {
      console.log("[Done] --stills-only requested; exiting after still verification.");
      return;
    }

    // 5. Render 540x960 preview MP4 (scale: 0.5) + mux audio
    const previewRawVideo = path.join(TRACKED_TMP_DIR, "preview_video_only.mp4");
    const previewFinalMp4 = path.join(OUT_DIR, "preview_15s_540x960.mp4");
    console.log("[5/6] Rendering 540x960 preview MP4 (450 frames, scale=0.5, concurrency=2)...");
    const tPrev0 = Date.now();
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 18,
      pixelFormat: "yuv420p",
      scale: 0.5,
      concurrency: 2,
      muted: true,
      outputLocation: previewRawVideo,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds: 300_000,
    });
    muxAudioWithVideo(previewRawVideo, wavOutPath, previewFinalMp4);
    const previewProbe = probeVideo(previewFinalMp4);
    fs.writeFileSync(path.join(QA_DIR, "ffprobe_preview.json"), JSON.stringify(previewProbe, null, 2));
    console.log(
      `[5/6] Preview MP4 complete in ${((Date.now() - tPrev0) / 1000).toFixed(1)}s -> ${previewFinalMp4}`,
    );

    // 6. Render native 1080x1920 FULL-RESOLUTION final MP4 (scale: 1, 450 frames) + mux audio
    const finalRawVideo = path.join(TRACKED_TMP_DIR, "final_video_only.mp4");
    const finalMp4 = path.join(OUT_DIR, "final_15s_1080x1920.mp4");
    console.log("[6/6] Rendering native 1080x1920 final MP4 (450 frames, scale=1, concurrency=2)...");
    const tFin0 = Date.now();
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 16,
      pixelFormat: "yuv420p",
      scale: 1,
      concurrency: 2,
      muted: true,
      outputLocation: finalRawVideo,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds: 600_000,
    });
    muxAudioWithVideo(finalRawVideo, wavOutPath, finalMp4);
    const finalProbe = probeVideo(finalMp4);
    fs.writeFileSync(path.join(QA_DIR, "ffprobe_final.json"), JSON.stringify(finalProbe, null, 2));
    console.log(
      `[6/6] Final 1080x1920 MP4 complete in ${((Date.now() - tFin0) / 1000).toFixed(1)}s -> ${finalMp4}`,
    );

    // 7. Run engine/scripts/short_qa.py across all 450 frames
    console.log("[QA] Running python3 scripts/short_qa.py on final_15s_1080x1920.mp4...");
    execFileSync(
      "python3",
      [path.join(ENGINE_DIR, "scripts/short_qa.py"), finalMp4, QA_DIR, shotPlanPath],
      { stdio: "inherit" },
    );

    // 8. Write manifest with SHA-256 and ffprobe verification summary
    const vStream = finalProbe.streams.find((s) => s.codec_type === "video");
    const aStream = finalProbe.streams.find((s) => s.codec_type === "audio");
    const manifest = {
      generatedAt: new Date().toISOString(),
      totalElapsedMs: Date.now() - tStart,
      browserExecutable: path.basename(browserExecutable),
      diskPreflightMb: diskInfo.availMb,
      finalMp4: {
        path: "out/oos-03/demo15/final_15s_1080x1920.mp4",
        sha256: sha256File(finalMp4),
        bytes: fs.statSync(finalMp4).size,
        width: vStream?.width,
        height: vStream?.height,
        rFrameRate: vStream?.r_frame_rate,
        nbFrames: Number(vStream?.nb_read_frames || vStream?.nb_frames || 0),
        durationSec: Number(finalProbe.format?.duration || 0),
        videoCodec: vStream?.codec_name,
        audioCodec: aStream?.codec_name,
        audioSampleRate: Number(aStream?.sample_rate || 0),
        audioChannels: Number(aStream?.channels || 0),
      },
      previewMp4: {
        path: "out/oos-03/demo15/preview_15s_540x960.mp4",
        sha256: sha256File(previewFinalMp4),
        bytes: fs.statSync(previewFinalMp4).size,
      },
      audioWav: {
        path: "out/oos-03/demo15/demo15-mix.wav",
        sha256: sha256File(wavOutPath),
        bytes: fs.statSync(wavOutPath).size,
      },
      stills: fs.readdirSync(STILLS_DIR).sort(),
      qaFiles: fs.readdirSync(QA_DIR).sort(),
    };
    fs.writeFileSync(path.join(OUT_DIR, "render-manifest.json"), JSON.stringify(manifest, null, 2));
    console.log("[PASS] Render & QA manifest written ->", path.join(OUT_DIR, "render-manifest.json"));
  } finally {
    try {
      fs.rmSync(TRACKED_TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } catch {
      // Best-effort cleanup if OS still holds a handle briefly
    }
    if (fs.existsSync(path.join(ENGINE_DIR, "public/demo15-mix.wav"))) {
      // Remove temporary copy from engine/public so git status --ignored stays clean in engine/public
      fs.rmSync(path.join(ENGINE_DIR, "public/demo15-mix.wav"), { force: true });
    }
  }
}

main().catch((err) => {
  console.error("FAIL render-oos-demo15:", err);
  process.exit(1);
});
