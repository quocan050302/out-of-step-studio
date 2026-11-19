// One command starts the unchanged Node API and the Vite development frontend.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const viteBin = path.join(dir, "node_modules", "vite", "bin", "vite.js");
const children = [];
let stopping = false;

function launch(args) {
  const child = spawn(process.execPath, args, { cwd: dir, env: process.env, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error("Development process exited:", args[0], code ?? signal);
      shutdown(code || 1);
    }
  });
  child.on("error", (err) => {
    console.error(err);
    shutdown(1);
  });
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
launch([path.join(dir, "server.mjs")]);
launch([viteBin, "--host", "127.0.0.1"]);
