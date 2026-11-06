import { spawn } from "node:child_process";

const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    // Detached groups include Next/Uvicorn descendants, so Ctrl-C leaves no orphan servers.
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    }
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
      }
    }
  }, 5000);
  timer.unref();
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

for (const service of ["dev:api", "dev:web", "dev:worker"]) {
  const child = spawn("pnpm", ["run", service], { stdio: "inherit", detached: true });
  children.push(child);
  child.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", event: "dev_process_failed", service, message: error.message }));
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(JSON.stringify({ level: "error", event: "dev_process_exited", service, code, signal }));
      stop(code || 1);
    }
  });
}
