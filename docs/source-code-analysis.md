# Source-code DNA

The DNA analysis page accepts a public GitHub repository URL, a ZIP source archive, or the single source file saved in a project. Local development can also analyze a trusted directory through the CLI. Every path uses deterministic, static inspection: repository scripts, package lifecycle hooks, imports, and build commands are never invoked.

## API

`POST /api/source/analyze` accepts one of these request forms:

- `application/zip` body with optional `X-Source-Filename` header.
- JSON `{ "github_url": "https://github.com/owner/repository" }` for a public repository root.
- JSON `{ "source_name": "Component.tsx", "source": "..." }` for one saved source file.

The Next.js same-origin route at `/api/source/analyze` validates and bounds the browser request before forwarding it. API results use `SourceDNA` schema version `1.0`, also validated by the shared TypeScript contract.

## ZIP and file safety

- ZIP upload: 20 MB compressed, 5,000 entries, 50 MB expanded, 2 MB per file, 250:1 maximum compression ratio, and 32 path segments.
- Absolute, drive-qualified, parent traversal, duplicate, encrypted, symbolic-link, and non-regular ZIP entries are rejected. Archives are read in memory and never extracted to disk.
- `.git`, dependency/build/cache/virtual-environment directories, environment files, private keys, and common credential files are excluded. Unsupported and binary file contents are not parsed.
- Only selected package metadata, README prose, route/component paths, CSS design tokens, known dependency names, and asset paths appear in the output. Package scripts are never returned. Credential-like text is redacted from user-facing summaries.
- Public GitHub retrieval accepts only `https://github.com/{owner}/{repo}` root links. It uses the public metadata API and codeload HTTPS hosts, re-resolves and pins public IPs for each request, disables proxy-environment use and cookies, applies download/time limits, and rejects redirects.
- Static image assets are reported as path references with `available_for_render: false`. They are not retained, decoded, fetched, or passed to Remotion.

The analysis output includes technology/dependency evidence, styling systems, CSS theme tokens, UI component/export paths, static Next/pages route paths, animation library declarations, README/package descriptions, heuristic category, motion opportunities, and a deterministic four-scene source storyboard. Product descriptions and categories remain heuristic. The storyboard is a proposal grounded in file paths and project metadata; it does not claim a browser capture or rendered asset exists.

## Trusted local directory mode

The public API never accepts a host filesystem path. To analyze a directory during trusted development, set `SOURCE_LOCAL_MODE=1` in the root `.env` and run:

```bash
UV_CACHE_DIR=/private/tmp/uv-motion-dna uv run --directory apps/api python -m motion_dna_api.source.local_cli /absolute/path/to/project
```

The CLI is disabled in production. It walks without following symlinks, rejects symlink entries, excludes dependency/build directories, and prints only the validated DNA JSON. It does not persist the files or execute repository content. Turn the local mode flag back off when directory analysis is not needed.

## Sample verification

`apps/api/tests/fixtures/source-next` is a small Next.js project containing routes, component examples, Tailwind/React/GSAP dependencies, theme variables, a logo candidate, a README, and a deliberately non-runnable lifecycle script. `apps/api/tests/test_source.py` zips it in memory and verifies the output signature while checking that the script and a fixture-only environment secret are absent from results. The test does not run npm, Node, or repository commands.
