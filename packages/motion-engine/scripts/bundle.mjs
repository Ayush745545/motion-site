import { cpSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
cpSync(path.join(root,"public/motion"),path.join(root,"../../apps/web/public/motion"),{recursive:true});
await bundle({entryPoint:path.join(root,"src/entry.tsx"),outDir:path.join(root,"dist"),publicDir:path.join(root,"public")});
console.log("Motion DNA Remotion bundle built.");
