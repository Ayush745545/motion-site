import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Optional Docker-free development database. It owns only .cache/postgres.
const root = fileURLToPath(new URL("../", import.meta.url));
const config = { ...(existsSync(join(root, ".env")) ? parseEnv(readFileSync(join(root, ".env"), "utf8")) : {}), ...process.env };
const port = Number(config.POSTGRES_PORT || "5432");
const user = config.POSTGRES_USER || "motiondna";
const database = config.POSTGRES_DB || "motiondna";
const password = config.POSTGRES_PASSWORD || "motiondna_local";
if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(user) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database) || !password || /[\r\n]/.test(password)) {
  throw new Error("Invalid native PostgreSQL port, role, database, or password configuration.");
}
const pgConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
const bin = config.POSTGRES_BIN || (pgConfig.status === 0 ? pgConfig.stdout.trim() : "");
if (!bin || !existsSync(join(bin, "pg_ctl"))) {
  throw new Error("Install PostgreSQL 17 and put pg_config on PATH, or set POSTGRES_BIN to its bin directory.");
}
const data = resolve(root, ".cache/postgres");
const sockets = resolve(root, ".cache/postgres-socket");
function run(tool, args, extra = {}) {
  const result = spawnSync(join(bin, tool), args, { stdio: "inherit", ...extra });
  if (result.status !== 0) throw new Error(`${tool} failed. Check .cache/postgres.log and the configured port.`);
}
const action = process.argv[2];
if (action === "down") {
  if (existsSync(join(data, "postmaster.pid"))) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  else console.log("The workspace PostgreSQL instance is already stopped.");
} else if (action === "up") {
  mkdirSync(sockets, { recursive: true });
  if (!existsSync(join(data, "PG_VERSION"))) {
    const pwfile = resolve(root, ".cache/postgres-init-password");
    writeFileSync(pwfile, password + "\n", { mode: 0o600 });
    try {
      run("initdb", ["-D", data, "-U", user, "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile", pwfile, "--encoding=UTF8", "--locale=C"]);
    } finally { unlinkSync(pwfile); }
  }
  const status = spawnSync(join(bin, "pg_ctl"), ["-D", data, "status"], { stdio: "ignore" });
  if (status.status !== 0) {
    run("pg_ctl", ["-D", data, "-l", resolve(root, ".cache/postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -k '${sockets.replaceAll("'", "'\\''")}'`, "-w", "start"]);
  }
  const runningPort = readFileSync(join(data, "postmaster.pid"), "utf8").split("\n")[3];
  if (runningPort !== String(port)) {
    throw new Error("The workspace database is running on a different port. Run pnpm db:native:down before changing POSTGRES_PORT and restarting.");
  }
  const connectionEnv = { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: user, PGPASSWORD: password, PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "3" };
  // Feed SQL through stdin so psql can substitute a properly quoted variable.
  const existing = spawnSync(join(bin, "psql"), ["-X", "-tA", "-v", `target=${database}`], { input: "SELECT 1 FROM pg_database WHERE datname = :'target';\n", env: connectionEnv, encoding: "utf8" });
  if (existing.status !== 0) throw new Error("Cannot connect to workspace PostgreSQL. Check credentials and .cache/postgres.log.");
  if (existing.stdout.trim() !== "1") run("createdb", ["--owner", user, database], { env: connectionEnv });
  console.log(`Workspace PostgreSQL is ready on 127.0.0.1:${port}. Data: ${data}`);
  console.log("DATABASE_URL in .env must use the same role, password, database, and port.");
} else {
  throw new Error("Usage: node scripts/native-postgres.mjs up|down");
}
