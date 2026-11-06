import { z } from "zod";

const AllowedOriginsSchema = z.string().default('["http://localhost:3000","http://127.0.0.1:3000"]')
  .transform((value, context) => {
    try { return JSON.parse(value) as unknown; }
    catch { context.addIssue({ code: "custom", message: "CORS_ALLOWED_ORIGINS must be a JSON array" }); return z.NEVER; }
  }).pipe(z.array(z.url().refine(value => {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value && !value.includes("*");
  }, "Use explicit HTTP(S) origins")).min(1));

const ServerEnvSchema = z.object({
  CORS_ALLOWED_ORIGINS: AllowedOriginsSchema,
  API_BASE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && (url.pathname === "/" || url.pathname === "");
  }, "API_BASE_URL must be an HTTP(S) origin without credentials, query, or path")
    .default("http://127.0.0.1:8000")
    .transform((value) => value.replace(/\/$/, "")),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/** Call from server modules only; this module never exposes process env to clients. */
export function getServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  return ServerEnvSchema.parse(env);
}
