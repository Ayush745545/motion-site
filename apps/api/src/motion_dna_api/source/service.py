"""Deterministic source inspection. No repository commands, imports, or scripts run here."""

import json
import re
from datetime import UTC, datetime
from pathlib import PurePosixPath

from .models import (
    Component,
    Dependency,
    Evidence,
    MotionOpportunity,
    Route,
    SourceDNA,
    SourceStoryboard,
    StaticAsset,
    StoryScene,
    Technology,
    ThemeToken,
)

MAX_FILES = 5000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 50 * 1024 * 1024
SOURCE_EXTENSIONS = {
    ".json",
    ".md",
    ".mdx",
    ".txt",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".html",
    ".yaml",
    ".yml",
    ".toml",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".avif",
    ".gif",
}
TEXT_EXTENSIONS = SOURCE_EXTENSIONS - {".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"}
SECRET_PATTERNS = [
    re.compile(
        r"(?i)(?:\"?(?:api[_-]?key|access[_-]?token|secret|password|credential)\"?\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+))"
    ),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
]
PACKAGE_ID = re.compile(r"^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+$")
SAFE_VERSION = re.compile(r"^[A-Za-z0-9*^~<>=|.+_ -]{0,80}$")

FRAMEWORKS = {
    "next": "Next.js",
    "react": "React",
    "vite": "Vite",
    "astro": "Astro",
    "@remix-run/react": "Remix",
    "react-router": "React Router",
    "nuxt": "Nuxt",
    "vue": "Vue",
    "svelte": "Svelte",
    "@angular/core": "Angular",
    "gatsby": "Gatsby",
}
STYLING = {
    "tailwindcss": "Tailwind CSS",
    "styled-components": "styled-components",
    "@emotion/react": "Emotion",
    "sass": "Sass",
    "less": "Less",
    "@vanilla-extract/css": "Vanilla Extract",
    "@unocss/vite": "UnoCSS",
}
ANIMATION = {
    "gsap": "GSAP",
    "framer-motion": "Framer Motion",
    "motion": "Motion",
    "@motionone/dom": "Motion One",
    "animejs": "Anime.js",
    "@react-spring/web": "React Spring",
    "react-spring": "React Spring",
    "lottie-react": "Lottie",
    "auto-animate": "Auto Animate",
}
ASSET_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"}
SKIP_PARTS = {
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    ".venv",
    "venv",
    "vendor",
    "target",
    ".cache",
    "__pycache__",
    ".turbo",
}


def _text(content: bytes) -> str:
    return content.decode("utf-8", errors="replace")[:MAX_FILE_BYTES]


def _safe_text(value: str, max_length: int = 600) -> str:
    value = value.replace("\x00", " ")
    for pattern in SECRET_PATTERNS:
        value = pattern.sub("[redacted]", value)
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:max_length]


def _display_name(value: str) -> str:
    clean = _safe_text(value, 180)
    clean = re.sub(r"^(?:@[^/]+/)?", "", clean)
    clean = re.sub(r"[-_.]+", " ", clean).strip()
    return clean.title()[:120] or "Source project"


def _package(files: dict[str, bytes]) -> tuple[dict, dict, str, str]:
    raw = files.get("package.json")
    if not raw:
        return {}, {}, "", ""
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return {}, {}, "", ""
    if not isinstance(value, dict):
        return {}, {}, "", ""
    runtime = value.get("dependencies", {})
    development = value.get("devDependencies", {})
    runtime = runtime if isinstance(runtime, dict) else {}
    development = development if isinstance(development, dict) else {}
    description = value.get("description", "")
    description = _safe_text(description, 600) if isinstance(description, str) else ""
    package_name = value.get("name", "")
    package_name = _display_name(package_name) if isinstance(package_name, str) else ""
    return runtime, development, description, package_name


def _dependencies(runtime: dict, development: dict):
    found: dict[tuple[str, str], Dependency] = {}
    for group, values in (("runtime", runtime), ("development", development)):
        for raw_name, raw_version in values.items():
            if not isinstance(raw_name, str) or not PACKAGE_ID.fullmatch(raw_name.casefold()):
                continue
            version = (
                _safe_text(raw_version, 80)
                if isinstance(raw_version, str) and SAFE_VERSION.fullmatch(raw_version)
                else ""
            )
            dependency = Dependency(name=raw_name[:120], version=version, group=group)
            found[(raw_name.casefold(), group)] = dependency
    return sorted(found.values(), key=lambda entry: (entry.name.casefold(), entry.group))[:120]


def _technology(name: str, version: str, evidence: str, confidence: float = 0.96):
    return Technology(
        name=name, version=version[:80], evidence=evidence[:240], confidence=confidence
    )


def _manifest_version(deps, name):
    for key, version in deps.items():
        if key.casefold() == name.casefold():
            return version if isinstance(version, str) and SAFE_VERSION.fullmatch(version) else ""
    return ""


def _find_text(files: dict[str, bytes], paths: set[str] | None = None):
    return {
        path: _text(content)
        for path, content in files.items()
        if PurePosixPath(path).suffix.casefold() in TEXT_EXTENSIONS
        and (paths is None or path in paths)
    }


def _routes(paths: list[str]):
    result: dict[tuple[str, str], Route] = {}
    for path in paths:
        parts = PurePosixPath(path).parts
        if "app" in parts:
            index = parts.index("app")
            tail = list(parts[index + 1 :])
            leaf = PurePosixPath(tail[-1]).stem if tail else ""
            if leaf in {"page", "route"}:
                segments = []
                for part in tail[:-1]:
                    if part.startswith("(") and part.endswith(")"):
                        continue
                    if part.startswith("@") or part.startswith("_"):
                        continue
                    segments.append(
                        f":{part[1:-1]}" if part.startswith("[") and part.endswith("]") else part
                    )
                route = "/" + "/".join(segments)
                kind = "api" if "api" in segments else ("api" if leaf == "route" else "page")
                result[(route, kind)] = Route(path=route, kind=kind, evidence=path[:240])
        elif "pages" in parts:
            index = parts.index("pages")
            rel = list(parts[index + 1 :])
            stem = PurePosixPath(rel[-1]).stem if rel else ""
            if stem in {"index", "_app", "_document"}:
                rel = rel[:-1]
                if stem != "index":
                    continue
            else:
                rel[-1] = stem
            route_parts = [
                f":{part[1:-1]}" if part.startswith("[") and part.endswith("]") else part
                for part in rel
            ]
            route = "/" + "/".join(route_parts)
            result[(route, "api" if route.startswith("/api/") else "page")] = Route(
                path=route, kind="api" if route.startswith("/api/") else "page", evidence=path[:240]
            )
    return sorted(result.values(), key=lambda item: item.path)[:120]


def _components(files: dict[str, bytes]):
    result = []
    export_pattern = re.compile(
        r"\bexport\s+(?:default\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)"
    )
    for path, content in sorted(files.items()):
        parts = PurePosixPath(path).parts
        if "components" not in (part.casefold() for part in parts) or PurePosixPath(
            path
        ).suffix.casefold() not in {".tsx", ".jsx", ".ts", ".js"}:
            continue
        names = list(dict.fromkeys(export_pattern.findall(_text(content))))[:16]
        result.append(Component(path=path[:240], exports=names))
        if len(result) >= 80:
            break
    return result


def _theme_tokens(text_files: dict[str, str]):
    result: dict[tuple[str, str], ThemeToken] = {}
    css_pattern = re.compile(
        r"--([\w-]{1,100})\s*:\s*(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^;{}]{1,80}\)|[\w.-]{1,48}(?:px|rem|em|%)?|['\"][^'\"]{1,80}['\"])"
    )
    for path, text in text_files.items():
        if not path.casefold().endswith((".css", ".scss", ".sass", ".less")):
            continue
        for name, value in css_pattern.findall(text):
            value = value.strip()
            if name.startswith("font-"):
                kind = "font"
                value = _safe_text(value.strip(" '\""), 100)
                if not re.fullmatch(r"[A-Za-z0-9 ,._-]{1,100}", value):
                    continue
            elif value.startswith("#") or value.startswith(("rgb(", "rgba(", "hsl(", "hsla(")):
                kind = "color"
            elif value.endswith(("px", "rem", "em", "%")) or value.replace(".", "", 1).isdigit():
                kind = (
                    "spacing"
                    if "space" in name or "gap" in name
                    else "radius"
                    if "radius" in name
                    else "spacing"
                )
            else:
                continue
            token_name = f"--{name}"
            token = ThemeToken(
                name=token_name[:120], value=value[:120], kind=kind, evidence=path[:240]
            )
            result[(token_name, value)] = token
            if len(result) >= 100:
                return list(result.values())
    font_pattern = re.compile(r"font-family\s*:\s*([^;{}]{1,120})", re.I)
    for path, text in text_files.items():
        if not path.casefold().endswith((".css", ".scss", ".sass", ".less")):
            continue
        for index, raw in enumerate(font_pattern.findall(text)):
            value = _safe_text(raw, 100).strip(" '\"`")
            if value:
                name = "font-family" if index == 0 else f"font-family-{index + 1}"
                result[(name, value)] = ThemeToken(
                    name=name, value=value, kind="font", evidence=path[:240]
                )
                if len(result) >= 100:
                    break
    return list(result.values())


def _summary(files: dict[str, bytes], package_summary: str):
    readme = next(
        (
            p
            for p in files
            if PurePosixPath(p).name.casefold() in {"readme.md", "readme.mdx", "readme.txt"}
        ),
        None,
    )
    if not readme:
        return "", package_summary, []
    raw = _text(files[readme])
    lines = [line.strip() for line in raw.splitlines()]
    title = next((_safe_text(line.lstrip("# "), 160) for line in lines if line.startswith("#")), "")
    blocks, current = [], []
    in_code = False
    for line in lines:
        if line.startswith("```") or line.startswith("~~~"):
            in_code = not in_code
            if current:
                blocks.append(" ".join(current))
                current = []
            continue
        if in_code:
            continue
        if not line or line.startswith(("#", "!", "[![", "<", "---")):
            if current:
                blocks.append(" ".join(current))
                current = []
            continue
        current.append(line)
        if sum(len(part) for part in current) > 700:
            blocks.append(" ".join(current))
            current = []
        if len(blocks) >= 4:
            break
    if current:
        blocks.append(" ".join(current))
    paragraph = re.sub(r"`([^`]+)`", r"\1", blocks[0]) if blocks else ""
    paragraph = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", paragraph)
    paragraph = _safe_text(paragraph, 500)
    summary = " · ".join(part for part in [title, paragraph] if part)[:600]
    evidence = []
    if summary:
        evidence.append(Evidence(path=readme[:240], claim=summary[:240], confidence=0.82))
    if package_summary:
        evidence.append(Evidence(path="package.json", claim=package_summary[:240], confidence=0.9))
    return summary, package_summary or paragraph, evidence[:12]


def _category(summary: str):
    text = summary.casefold()
    terms = {
        "saas": ("saas", "dashboard", "workflow", "subscription", "workspace", "software"),
        "ecommerce": ("shop", "store", "cart", "commerce", "products", "checkout"),
        "portfolio": ("portfolio", "selected work", "photography", "artist", "projects"),
        "agency": ("agency", "creative studio", "clients", "campaigns", "branding"),
        "mobile": ("mobile app", "ios", "android", "app store", "react native"),
        "technology": ("developer", "platform", "technology", "infrastructure", "open source"),
    }
    scores = {key: sum(1 for term in values if term in text) for key, values in terms.items()}
    category = max(scores, key=scores.get)
    if not scores[category]:
        return "technology", 0.2
    return category, min(0.9, 0.45 + 0.1 * scores[category])


def analyze_files(files: dict[str, bytes], source_type: str, source_name: str) -> SourceDNA:
    if not files:
        raise ValueError("No supported source or asset files were found.")
    if len(files) > MAX_FILES or sum(map(len, files.values())) > MAX_TOTAL_BYTES:
        raise ValueError("The source project exceeds analysis limits.")
    files = {path: content for path, content in files.items() if _source_path(path)}
    if not files:
        raise ValueError("No supported source or asset files were found.")

    runtime, development, package_summary, package_name = _package(files)
    deps = _dependencies(runtime, development)
    dep_lookup = {dep.name.casefold(): dep for dep in deps}
    tech: list[Technology] = []
    for package, name in FRAMEWORKS.items():
        dependency = dep_lookup.get(package)
        if dependency:
            tech.append(_technology(name, dependency.version, "package.json"))
    for marker, name in (
        ("next.config.", "Next.js"),
        ("vite.config.", "Vite"),
        ("astro.config.", "Astro"),
    ):
        found = next((path for path in files if PurePosixPath(path).name.startswith(marker)), None)
        if found and not any(item.name == name for item in tech):
            tech.append(_technology(name, "", found, 0.85))
    if not tech:
        tech.append(
            _technology(
                "Framework not identified", "", "No supported manifest or config found", 0.2
            )
        )

    styling = [
        _technology(name, dep_lookup[pkg].version, "package.json")
        for pkg, name in STYLING.items()
        if pkg in dep_lookup
    ]
    style_markers = (
        ("tailwind.config.", "Tailwind CSS"),
        ("postcss.config.", "PostCSS"),
        ("\.module.css", "CSS Modules"),
    )
    for marker, name in style_markers:
        found = next(
            (
                path
                for path in files
                if (marker.startswith("\\.") and marker[1:] in path)
                or (not marker.startswith("\\.") and PurePosixPath(path).name.startswith(marker))
            ),
            None,
        )
        if found and not any(entry.name == name for entry in styling):
            styling.append(_technology(name, "", found, 0.85))

    animations = [
        _technology(name, dep_lookup[pkg].version, "package.json")
        for pkg, name in ANIMATION.items()
        if pkg in dep_lookup
    ]
    text_files = _find_text(files)
    if any(
        re.search(r"\btransition(?:-property|-duration)?\s*:", text, re.I)
        for text in text_files.values()
    ):
        animations.append(
            _technology(
                "CSS transitions",
                "",
                next(
                    (
                        path
                        for path, text in text_files.items()
                        if re.search(r"\btransition(?:-property|-duration)?\s*:", text, re.I)
                    ),
                    "styles",
                ),
                0.8,
            )
        )
    components = _components(files)
    routes = _routes(list(files))
    theme = _theme_tokens(text_files)
    summary, product, summary_evidence = _summary(files, package_summary)
    category, category_confidence = _category(" ".join((summary, product)))
    assets = []
    for path in sorted(files):
        suffix = PurePosixPath(path).suffix.casefold()
        if suffix not in ASSET_EXTENSIONS:
            continue
        basename = PurePosixPath(path).name.casefold()
        assets.append(
            StaticAsset(
                path=path[:240],
                kind="logo_candidate"
                if any(part in basename for part in ("logo", "brand", "mark"))
                else "image",
                reason=(
                    "Source assets are path references only; "
                    "the archive is not retained or rendered."
                ),
            )
        )
        if len(assets) >= 80:
            break

    evidence_paths = []
    if runtime or development:
        evidence_paths.append("package.json")
    evidence_paths.extend(component.path for component in components[:3])
    evidence_paths.extend(route.evidence for route in routes[:3])
    evidence_paths = list(dict.fromkeys(evidence_paths))[:8]
    motion_opportunities = []
    if animations:
        motion_opportunities.append(
            MotionOpportunity(
                suggestion=(
                    f"Use the detected {animations[0].name} system "
                    "for restrained interface reveals."
                ),
                evidence=[animations[0].evidence],
                confidence=min(0.9, animations[0].confidence),
            )
        )
    if components:
        motion_opportunities.append(
            MotionOpportunity(
                suggestion=(
                    "Reveal the observed UI component groups in sequence, "
                    "preserving their existing names and hierarchy."
                ),
                evidence=[component.path for component in components[:4]],
                confidence=0.78,
            )
        )
    if not motion_opportunities:
        motion_opportunities.append(
            MotionOpportunity(
                suggestion=(
                    "A simple title entrance and measured page reveal could introduce this "
                    "project without implying unobserved behavior."
                ),
                evidence=evidence_paths[:4],
                confidence=0.35,
            )
        )

    project_title = _display_name(package_name or source_name)
    framework = next(
        (item.name for item in tech if item.name != "Framework not identified"),
        "the detected project",
    )
    component_names = [PurePosixPath(component.path).stem for component in components[:3]]
    route_names = [route.path for route in routes[:3]]
    verified_summary = (
        product if product else "No product description was found in the provided source files."
    )
    source_evidence = list(
        dict.fromkeys([*(evidence.path for evidence in summary_evidence), *evidence_paths])
    )[:8]
    story_scenes = [
        StoryScene(
            id="intro",
            headline=project_title[:120] or "Source project",
            description="Introduce the repository using its verified project identity.",
            motion_preset="fade",
            evidence=source_evidence[:4],
            visual_assets=[],
            visual_assets_available=False,
        ),
        StoryScene(
            id="reveal",
            headline=f"Built with {framework}"[:120],
            description="Reveal the detected framework and styling fingerprint.",
            motion_preset="parallax",
            evidence=[item.evidence for item in tech[:3]] + [item.evidence for item in styling[:2]],
            visual_assets=[asset.path for asset in assets[:3]],
            visual_assets_available=False,
        ),
        StoryScene(
            id="features",
            headline=("UI: " + ", ".join(component_names))[:120]
            if component_names
            else ("Routes: " + ", ".join(route_names))[:120]
            if route_names
            else "Inside the project",
            description=(
                "Show only component names, routes, and design tokens found in source files."
            ),
            motion_preset="slide",
            evidence=(
                [component.path for component in components[:4]]
                or [route.evidence for route in routes[:4]]
                or source_evidence[:4]
            ),
            visual_assets=[asset.path for asset in assets[:3]],
            visual_assets_available=False,
        ),
        StoryScene(
            id="cta",
            headline="Explore the project" if summary else "Bring the project to life",
            description=(
                "Close on the repository identity with source assets marked unavailable "
                "until explicitly imported."
            ),
            motion_preset="fade",
            evidence=source_evidence[:4],
            visual_assets=[],
            visual_assets_available=False,
        ),
    ]
    warnings = [
        (
            "Static analysis only. Repository scripts, package lifecycle hooks, imports, "
            "and build commands were not executed."
        ),
        (
            "Source assets are referenced by path but are not retained, decoded, "
            "or available to the video renderer."
        ),
        "Product descriptions and category are heuristic readings of README and package metadata.",
    ]
    if not runtime and not development:
        warnings.append(
            "No package manifest was found; technology identification is based on file "
            "names and configuration markers."
        )
    return SourceDNA(
        source_type=source_type,
        source_name=project_title or _display_name(source_name),
        analyzed_at=datetime.now(UTC).isoformat(),
        technology_fingerprint=tech[:24],
        dependencies=deps,
        styling_systems=styling[:16],
        theme_tokens=theme[:100],
        ui_components=components[:80],
        animation_libraries=animations[:20],
        routes=routes[:120],
        readme_summary=summary,
        product_summary=_safe_text(verified_summary, 600),
        summary_evidence=summary_evidence,
        product_category=category,
        category_confidence=category_confidence,
        motion_opportunities=motion_opportunities[:12],
        assets=assets[:80],
        storyboard=SourceStoryboard(
            creative_concept=(
                f"A source-grounded introduction to {project_title}; every claim is tied "
                "to inspected metadata or file paths."
            ),
            opening_hook=project_title[:120] or "Source project",
            scenes=story_scenes,
            cta="Explore the project" if summary else "Bring the project to life",
            confidence=min(0.85, max(0.15, category_confidence if summary else 0.3)),
        ),
        confidence=min(
            0.95, 0.45 + min(len(files), 20) * 0.015 + (0.15 if runtime or development else 0)
        ),
        warnings=warnings[:16],
    )


def _source_path(path: str):
    pure = PurePosixPath(path)
    parts = pure.parts
    if pure.is_absolute() or any(part in {"..", "."} for part in parts) or len(parts) > 32:
        return False
    if any(part.casefold() in SKIP_PARTS for part in parts):
        return False
    basename = parts[-1].casefold() if parts else ""
    if (
        basename.startswith(".env")
        or basename in {"credentials.json", "secrets.json", "id_rsa", "id_ed25519"}
        or basename.endswith((".pem", ".key", ".p12", ".pfx"))
    ):
        return False
    return pure.suffix.casefold() in SOURCE_EXTENSIONS


def analyze_zip(data: bytes, source_name: str, source_type: str = "zip") -> SourceDNA:
    from .archive import read_zip

    return analyze_files(read_zip(data), source_type, source_name)
