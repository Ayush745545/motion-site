import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";

// Both apps share the gitignored workspace .env, regardless of the shell's cwd.
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)));
const config: NextConfig = {
  transpilePackages: ["@motion-dna/config", "@motion-dna/dna-schema", "@motion-dna/ui", "@motion-dna/motion-engine"],
  poweredByHeader: false,
};
export default config;
