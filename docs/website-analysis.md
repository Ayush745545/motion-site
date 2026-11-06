# Website DNA analysis (schema 1.0)

## Run on macOS

Keep existing `.env` settings. Install dependencies with `pnpm install --frozen-lockfile` and `pnpm setup:api`. Start Docker Desktop (`open -a Docker`), wait for `docker info` to succeed, then run:

```bash
pnpm setup:analyzer
pnpm db:up             # or pnpm db:native:up for an already configured native cluster
pnpm dev
```

If PostgreSQL already runs, do not start a competing database on the same port. This checkout uses its existing native cluster at port 55432. The browser image still requires Docker. No paid service or API key is used.

Create a website project, open **DNA analysis**, and click **Analyze website**. Results appear when the real job completes. Reloading restores the saved job reference and retrieves its database result. Source-code projects have analysis disabled with an explanation; uploaded code is never executed. Draft scene colors are intentionally not overwritten by heuristic extraction.

## API

```bash
curl -X POST http://127.0.0.1:8000/api/dna/analyze \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
# HTTP 202: job_id, status=queued, created_at, analysis_id=null

curl http://127.0.0.1:8000/api/dna/jobs/JOB_UUID
# queued -> running -> completed (analysis_id) or failed (error_code, error)

curl http://127.0.0.1:8000/api/dna/results/ANALYSIS_UUID
curl http://127.0.0.1:8000/api/dna/results/ANALYSIS_UUID/screenshots/viewport -o viewport.png
```

Next.js exposes the same allowlisted paths on port 3000 and validates the JSON responses using Zod. PostgreSQL must be available to admit a job. Malformed/unsafe input returns 422, a full local dispatcher returns 429, unavailable storage returns 503, and missing IDs return 404. Runtime capture failures appear on the persisted job, not as completed analysis.

## Data contract and interpretation

The committed `packages/dna-schema/dna-v1.schema.json` is generated from Pydantic's `DNAResult`; `packages/dna-schema/src/analysis.ts` validates the frontend contract. The API validates every browser-produced result before saving it. All collection lengths, strings, counts and confidence values are bounded.

- **Palette:** computed colors normalized to sRGB (including browser-supported modern CSS color syntax; alpha below 0.5 is excluded), grouped as background/text/button-primary/link-accent. Count is sampled element frequency; frequency is normalized within each role. This is not a pixel histogram or definitive brand guide.
- **Typography:** computed CSS families, sizes, weights, occurrence counts, H1–H6 hierarchy and browser font availability checks. Font fallback can differ from declared CSS; availability does not prove the exact glyph-rendering font.
- **Layout:** visible navigation, sections, buttons and grids; hero/card candidates use selectors and receive lower heuristic confidence. Density is clamped viewport text-box coverage, not semantic visual complexity.
- **Motion:** computed transition properties/durations, animation names/durations, timing functions and transforms. `motion_scope` is always `computed-css-only`. JavaScript libraries, canvas, scroll choreography and full interaction behavior are **not** analyzed.
- **Media:** visible image and CSS background-image references with logo/hero candidate classification and dimensions. Query strings/fragments are omitted. The UI lists references without fetching third-party media. Inline SVG and video are not extracted as standalone assets.
- **Public content:** bounded title, headings, paragraphs and CTA labels, excluding forms/editable/private-marked elements; supplied to the grounded AI Director. Older captures may omit this optional field.
- **Capture:** one 1440×900 viewport PNG; form inputs, textareas, selects, editable surfaces and iframes are masked. Captures contain public page pixels, not a signed-in user's browser state.
- **Confidence:** heuristic scores, not statistically calibrated probabilities. Blocked resources lower overall confidence and add warnings.

The page settles for 1.5 seconds after DOM content is ready and waits at most two further seconds for fonts. Dynamic content appearing in that window is included. No scrolling, clicking, login, form submission or cookie-banner acceptance occurs. Samples cover at most the first 5,000 DOM elements. Closed shadow roots, iframe content and offscreen lazy media may be absent.

## Security boundary

The browser runs only inside the configured image. There is no host-browser fallback and no production option to allow internal addresses.

1. Only HTTP(S), ports 80/443, credential-free URLs are accepted. Public DNS resolution must succeed. Local names, private, loopback, link-local, multicast, reserved, metadata/CGNAT and IPv4-mapped/transition addresses are denied. Mixed public/private DNS answer sets are rejected.
2. Every browser GET goes through a host-side broker. The broker resolves each hop, validates **all** returned addresses, and supplies those exact addresses to an aiohttp connector. There is no second unconstrained DNS lookup. Every redirect is independently validated, with a six-hop ceiling. DNS rebinding cannot make a connector switch from the validated public address to a private address.
3. The container uses `--network=none`, a read-only root filesystem, no host mounts or Docker socket, no inherited application secrets, UID 1000, all capabilities dropped, `no-new-privileges`, one CPU, 768 MB memory, 128 PIDs, and bounded tmpfs/shared memory. Chromium's own sandbox is not relied on; the container and Docker VM on macOS are the execution boundary. This local design is not an internet-facing multi-tenant service.
4. Network requests use no ambient proxies, `.netrc`, browser cookies, authentication, submitted form bodies or caller headers. TLS verification remains enabled. POST/PUT and media downloads are blocked; service workers, WebSockets, popups and child-frame navigation are blocked. The browser cannot bypass the broker with direct sockets because it has no network.
5. Incoming analysis requests are capped at 4 KB. The broker permits at most 100 requests, 2 MB per response and 20 MB total. Responses are streamed with limits. It requests identity encoding and rejects compressed responses rather than risking decompression expansion. DNS has a 3-second deadline, each fetch 8 seconds, page navigation 20 seconds, and the whole job 50 seconds. Screenshots are limited to 2 MB and worker IPC lines to 4 MB.
6. Containers are forcibly removed on completion, error, cancellation or deadline. Browser output is treated as untrusted and validated. No cookies, localStorage or form values are serialized. Bounded public headings, paragraphs and CTA labels are now retained for the Director, alongside public pixels and CSS/media metadata. A website may put public personal information in its visible content; the analyzer does not promise screenshot redaction beyond the masked controls.

Website analysis requires a signed-in local account and an owned project. Explicit CORS/origin checks, rate limits, and project ownership checks complement the isolated browser network policy. This local API is not a production deployment; do not expose it to the internet.

## Persistence and lifecycle

`dna_jobs` is initialized lazily under a PostgreSQL advisory lock. It contains UUID, owner/project UUIDs, timestamp, validated job JSON, validated result JSON and PNG bytes. Successful results are also linked from the owned `dna_analyses` and project document. No URL query strings or browser sessions are persisted. A project's DNA job, result and screenshot are inaccessible after project deletion and are removed during the project retention purge.

There are at most two admitted jobs per API process. Restarting the API does not resume jobs: active records older than two minutes become failed/interrupted when read. Starting another capture retains approximately the latest 100 finished records per user; older captures may return 404. Screenshots use at most about 200 MB for those records, plus bounded JSON metadata. Soft-deleting a project immediately blocks its capture records; the scheduled 30 day purge removes the associated database rows. This phase intentionally does not add Redis or a distributed scheduler.

## Verification

```bash
pnpm check                # lint, strict TypeScript, unit/security tests, builds
pnpm test:analyzer        # real networkless Chromium + local HTTP fixtures; Docker required
pnpm test:dna:e2e         # real example.com capture through UI; database/internet required
pnpm test:e2e             # existing UI regression suite; live DNA case skipped by default
```

Fixture tests cover dynamic DOM/fetch, palette, headings, missing fonts, layout, CSS animation, image candidates, redirect rejection and deadline cleanup. Test-only monkeypatches route one synthetic fixture hostname to a local server; they are never exposed through configuration or production input. Broker tests independently check unsafe URLs/IPs, mixed DNS answers, rebinding, redirect destinations, encoded responses and byte/request budgets.

If Docker or the image is missing, the job fails with a setup instruction. If PostgreSQL is down, submission fails before returning a job ID. Captcha, bot protection, sites requiring cookies, unsupported encodings, large resources and late-loading content can cause failed or partial captures; errors and warnings are displayed honestly.

Design references: [Playwright network interception](https://playwright.dev/python/docs/network), [Playwright container guidance](https://playwright.dev/python/docs/docker), and [aiohttp client/connector API](https://docs.aiohttp.org/en/stable/client_reference.html).
