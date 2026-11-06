# Phase 2: cinematic studio interface

Implemented in the existing repository and verified on macOS, 28 October 2026.

## Design and navigation

The interface uses near-black backgrounds, neutral surfaces, cobalt `#2563EB` accents, restrained glass on the header, responsive spacing, and scoped GSAP transitions. shadcn/ui source components provide buttons, inputs, labels, cards, and accessible dialogs. The mobile navigation drawer supports focus trapping, keyboard navigation, and Escape dismissal. Transitions respect OS and saved reduced-motion preferences.

All six pages are reachable through working desktop and mobile navigation:

| Page | Implemented behavior |
| --- | --- |
| Dashboard `/` | Actual local draft statistics, recent projects, search, sorting, grid/list views, create/open actions, and confirmed deletion |
| Create Project `/create` | HTTP(S) URL validation, source-file selection or pasted code, input errors, file reading state, and creation of three editable manual starter scenes |
| DNA Analysis `/analysis` | Source reference, explicit pending extraction state, and actual manual draft colors, type, layout, and animation settings |
| Motion Studio `/studio` | Projects/assets/templates sidebar, composition preview, playback controls, resolution selection, scene properties, color/type/animation controls, and timeline |
| Render Queue `/queue` | Live API probe, loading/error/empty states, real validated job data when available, and an explicit unavailable state for the current backend |
| Settings `/settings` | Persisted resolution/FPS defaults, reduced motion, reset, storage feedback/retry, and live API/database status |

## Working draft behavior

Drafts and preferences are stored in a versioned, Zod-validated localStorage document. Reloading restores projects, selected scenes, colors, typography, durations, resolution, and preferences. Storage failures are visible with a retry action; unreadable saved data is preserved before replacement.

The workspace supports up to 20 local projects and 12 scenes per project. Source text files are limited to 256 KB. Source references are not sent to the API and code is never executed. Clearing browser site data removes local drafts.

The editor supports scene selection, add, duplicate, delete, duration changes, seeking, play/pause, previous/next, Space playback, and arrow-key scene selection outside form fields. It guards temporary invalid numeric, name, and color edits. Manual scene presets apply real layout/type/animation changes. Render and media-import controls are disabled with explanations.

## Validation

- `pnpm check`: ESLint, Ruff, strict TypeScript, 56 unit tests, Next.js production build, and Python package build passed.
- `pnpm test:e2e`: seven Chromium acceptance tests passed.
- Browser coverage includes live API/PostgreSQL readiness, offline recovery, validated URL creation, source-file validation/import, draft reload, saved preferences/defaults, scene edits, keyboard playback, and six-page mobile navigation without page overflow.
- Additional browser checks verified project search, list view, deletion cancellation/confirmation and persistence, and render-service refresh returning a real structured 501.
- Desktop and 390px mobile screenshots of the dashboard, create form, and editor were inspected. A mobile dialog offset and an inefficient mobile property layout were repaired.

The existing development services remain available at `http://127.0.0.1:3000` and `http://127.0.0.1:8000`. Local PostgreSQL uses the previously configured isolated port 55432. Inside the restricted Codex environment, the final checks used the cached Python dependencies with `UV_CACHE_DIR=/private/tmp/motion-dna-uv-cache UV_OFFLINE=1`; ordinary macOS commands are documented in the README.

## Scope boundaries

Website capture, extracted DNA, database-backed project storage, actual video encoding/export, and render-job creation remain unimplemented. The new render proxy does not simulate jobs or advance progress. It returns a structured 501 when the actual FastAPI render endpoint is absent, and sanitized errors when unreachable or invalid. Starter scenes and brand settings are explicitly manual drafts.

No paid AI API, Redis service, worker, authentication flow, or deployment was added. Existing upstream development-tool deprecation notices remain documented in the phase 1 report.

See [macOS setup](development.md), [architecture](architecture.md), and [shadcn component provenance](ui-components.md).
