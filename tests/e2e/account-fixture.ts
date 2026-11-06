import { execFileSync } from "node:child_process";
import path from "node:path";
import { test as base, type BrowserContext } from "@playwright/test";

type TemporaryAccount = { id: string; cookie: string; contextCookie: Parameters<BrowserContext["addCookies"]>[0][number] };
type WorkerFixtures = { temporaryAccount: TemporaryAccount };

const root = process.cwd();
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const host = new URL(baseURL);
const python = path.join(root, "apps/api/.venv/bin/python");

const createAccountScript = String.raw`
import hashlib, json, secrets, sys, uuid
from datetime import datetime, timedelta, timezone
import psycopg
from motion_dna_api.config import Settings
from motion_dna_api.database import apply_migrations

owner_id = uuid.uuid4()
token = secrets.token_urlsafe(48)
email = f"playwright-{owner_id.hex}@example.test"
salt = secrets.token_bytes(16)
password = secrets.token_urlsafe(32).encode()
digest = hashlib.pbkdf2_hmac("sha256", password, salt, 310_000).hex()
password_hash = "pbkdf2_sha256$310000$" + salt.hex() + "$" + digest
token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
settings = Settings()
apply_migrations(settings)
with psycopg.connect(settings.database_url.get_secret_value()) as connection:
    connection.execute("INSERT INTO users(id,email,password_hash) VALUES (%s,%s,%s)", (owner_id, email, password_hash))
    connection.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (%s,%s,%s)", (token_hash, owner_id, datetime.now(timezone.utc) + timedelta(days=1)))
print(json.dumps({"id": str(owner_id), "token": token}))
`;

const cleanupAccountScript = String.raw`
import json, shutil, sys
from pathlib import Path
import psycopg
from motion_dna_api.config import Settings

owner_id = sys.argv[1]
settings = Settings()
with psycopg.connect(settings.database_url.get_secret_value()) as connection:
    job_ids = [str(row[0]) for row in connection.execute("SELECT id FROM render_jobs WHERE owner_id=%s", (owner_id,)).fetchall()]
    connection.execute("DELETE FROM users WHERE id=%s", (owner_id,))
asset_root = settings.render_storage_dir.parent / "private-assets" / owner_id
if asset_root.is_dir():
    shutil.rmtree(asset_root)
render_root = settings.render_storage_dir.resolve()
for job_id in job_ids:
    job_path = (render_root / job_id).resolve()
    if job_path.parent == render_root and job_path.is_dir():
        shutil.rmtree(job_path)
`;

function runPython(script: string, ...args: string[]) {
  return execFileSync(python, ["-c", script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      PYTHONPATH: [path.join(root, "apps/api/src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export const test = base.extend<object, WorkerFixtures>({
  temporaryAccount: [async ({}, use) => {
    const account = JSON.parse(runPython(createAccountScript)) as { id: string; token: string };
    try {
      await use({
        id: account.id,
        cookie: `motion_dna_session=${account.token}`,
        contextCookie: {
          name: "motion_dna_session",
          value: account.token,
          url: host.origin,
          httpOnly: true,
          secure: host.protocol === "https:",
          sameSite: "Lax",
        },
      });
    } finally {
      runPython(cleanupAccountScript, account.id);
    }
  }, { scope: "worker" }],
  page: async ({ page, temporaryAccount }, use) => {
    await page.context().addCookies([temporaryAccount.contextCookie]);
    const session = await page.request.get(`${host.origin}/api/auth/session`, {
      headers: { Cookie: temporaryAccount.cookie },
    });
    if (!session.ok()) {
      const cookies = await page.context().cookies(host.origin);
      throw new Error(`The temporary authenticated session was rejected (${session.status()}; cookie=${cookies.some(cookie => cookie.name === "motion_dna_session")}; ${await session.text()}).`);
    }
    await use(page);
  },
});

export { expect } from "@playwright/test";
export type { APIRequestContext, Page } from "@playwright/test";
