"""Grounded copy assembly and category-aware deterministic direction."""

import asyncio
import re

from .models import Brief, DirectorInput, Fact, Generation, Plan, PlanScene, Scene, Storyboard

KEYWORDS = {
    "saas": ["saas", "dashboard", "workflow", "software", "workspace", "subscription"],
    "ecommerce": ["shop", "cart", "shipping", "collection", "store", "purchase"],
    "portfolio": ["portfolio", "selected work", "photographer", "illustrator", "artist"],
    "agency": ["agency", "clients", "creative studio", "branding", "campaigns"],
    "mobile": ["mobile app", "app store", "android", "ios", "download the app"],
    "technology": ["startup", "technology", "developer", "platform", "infrastructure"],
}
WEIGHTS = {
    "saas": [16, 32, 34, 18],
    "ecommerce": [15, 25, 40, 20],
    "portfolio": [18, 40, 26, 16],
    "agency": [18, 25, 38, 19],
    "mobile": [15, 40, 28, 17],
    "technology": [20, 25, 38, 17],
}
DIRECTIONS = {
    "saas": "Interface first, then evidenced product benefits",
    "ecommerce": "Lead with the collection, then source-backed product details",
    "portfolio": "Let the selected work lead the story",
    "agency": "Introduce the studio, then showcase its published work",
    "mobile": "Reveal the app interface, then its documented experience",
    "technology": "Introduce the idea, then its documented capabilities",
}
DESCRIPTIONS = {
    "intro": "Introduce the brand with the source headline and animated identity.",
    "reveal": "Reveal the captured website with a controlled camera move.",
    "features": "Present source-backed highlights as staggered cards.",
    "cta": "Close with the website address and source call to action.",
}


def facts_for(data: DirectorInput):
    candidates = []
    if data.dna.content:
        candidates += [
            (text, "website")
            for text in [
                *data.dna.content.headings,
                *data.dna.content.paragraphs,
                *data.dna.content.ctas,
            ]
        ]
    candidates += [
        (text, "provided_summary") for text in re.split(r"\n+|(?<=[.!?])\s+", data.content_summary)
    ]
    facts, seen = [], set()
    for text, source in candidates:
        text = " ".join(text.split())[:240]
        if text and text.casefold() not in seen:
            seen.add(text.casefold())
            facts.append(Fact(id=f"fact-{len(facts)}", text=text, source=source))
        if len(facts) == 24:
            break
    return facts


def classify(data, facts):
    if data.product_category != "auto":
        return data.product_category, 1.0
    text = " ".join(fact.text for fact in facts).lower()
    scores = {
        category: sum(bool(re.search(r"\b" + re.escape(word) + r"\b", text)) for word in words)
        for category, words in KEYWORDS.items()
    }
    category = max(scores, key=scores.get)
    if not scores[category]:
        return "technology", 0.2
    return category, min(0.9, 0.45 + scores[category] * 0.1)


def fallback_plan(data, facts, category):
    total = data.duration_seconds * 30
    frames = [total * weight // 100 for weight in WEIGHTS[category]]
    frames[-1] += total - sum(frames)
    ordered = (
        facts[data.variant % len(facts) :] + facts[: data.variant % len(facts)] if facts else []
    )
    ids = [fact.id for fact in ordered]
    preset = {
        "cinematic": "parallax",
        "saas": "spring",
        "typography": "fade",
        "technology": "slide",
        "walkthrough": "slide",
    }[data.motion_style]
    return Plan(
        opening_fact_id=ids[0] if ids else None,
        scenes=[
            PlanScene(
                kind=kind,
                fact_ids=ids[:3] if kind == "features" else ids[:1],
                duration_frames=frames[index],
                motion_preset=preset,
                transition="slide" if data.motion_style == "technology" else "fade",
            )
            for index, kind in enumerate(["intro", "reveal", "features", "cta"])
        ],
    )


async def direct(data: DirectorInput, provider=None):
    facts = facts_for(data)
    category, confidence = classify(data, facts)
    plan = fallback_plan(data, facts, category)
    requested = provider.name if provider else "deterministic"
    requested_model = provider.model if provider else "rules-v1"
    fallback_reason = (
        "No LLM configured; deterministic direction selected." if not provider else None
    )
    used = "deterministic"
    model = "rules-v1"
    if provider:
        try:
            proposed = Plan.model_validate(
                await asyncio.wait_for(
                    provider.generate(
                        {
                            "facts": [fact.model_dump() for fact in facts],
                            "category": category,
                            "target_audience": data.target_audience,
                            "total_frames": data.duration_seconds * 30,
                            "aspect_ratio": data.aspect_ratio,
                            "dna_signatures": {
                                "palette": [c.model_dump() for c in data.dna.palette[:8]],
                                "motion_scope": data.dna.motion_scope,
                                "layout": data.dna.layout.model_dump(),
                            },
                            "style": data.motion_style,
                            "variant": data.variant,
                        }
                    ),
                    timeout=13,
                )
            )
            known = {fact.id for fact in facts}
            if (
                sum(scene.duration_frames for scene in proposed.scenes)
                != data.duration_seconds * 30
                or any(not set(scene.fact_ids) <= known for scene in proposed.scenes)
                or (proposed.opening_fact_id and proposed.opening_fact_id not in known)
                or proposed.scenes[0].kind != "intro"
                or proposed.scenes[-1].kind != "cta"
            ):
                raise ValueError("Invalid or ungrounded plan")
            plan, used, model = (
                proposed,
                provider.name,
                getattr(provider, "actual_model", provider.model),
            )
        except Exception:
            fallback_reason = (
                "Provider unavailable or invalid plan; used grounded deterministic direction."
            )
    lookup = {fact.id: fact.text for fact in facts}
    hook = lookup.get(plan.opening_fact_id, "Explore the website.")[:100]
    ctas = data.dna.content.ctas if data.dna.content else []
    cta = ctas[0][:72] if ctas else "Explore the website."
    screenshot_refs = [shot.path for shot in data.dna.screenshots]
    assets = [asset.url for asset in data.dna.assets[:6]]
    scenes = []
    for item in plan.scenes:
        copy = [lookup[identifier] for identifier in item.fact_ids]
        headline = (
            cta
            if item.kind == "cta"
            else hook
            if item.kind == "intro"
            else (copy[0][:100] if copy else "Website capture")
        )
        scenes.append(
            Scene(
                **item.model_dump(),
                id=item.kind,
                headline=headline,
                description=DESCRIPTIONS[item.kind],
                supporting_copy=copy,
                visual_asset_refs=(screenshot_refs + assets)[:8]
                if item.kind in {"reveal", "features"}
                else [],
            )
        )
    warnings = [
        "Source quotations are used verbatim; editorial descriptions describe visuals only.",
        "User-provided summaries are treated as supplied evidence, not independently verified.",
    ]
    if not data.dna.screenshots:
        warnings.append(
            "No captured screenshot reference is available; capture the site before rendering."
        )
    if len(facts) < 3:
        warnings.append("Fewer than three source facts; neutral visual placeholders may be needed.")
    if not facts:
        warnings.append(
            "No content evidence supplied. Only neutral website language was generated."
        )
    if confidence < 0.5:
        warnings.append("Category inference is weak. Select a category explicitly.")
    return Storyboard(
        brief=Brief.model_validate(data.model_dump(exclude={"dna"})),
        analysis_id=str(data.dna.analysis_id),
        category=category,
        category_confidence=confidence,
        creative_concept=f"{DIRECTIONS[category]}. For {data.target_audience}."[:240],
        opening_hook=hook,
        scenes=scenes,
        cta=cta,
        evidence=facts,
        total_frames=data.duration_seconds * 30,
        generation=Generation(
            provider=used,
            model=model,
            requested_provider=requested,
            requested_model=requested_model,
            fallback_used=used == "deterministic",
            fallback_reason=fallback_reason,
            confidence=min(data.dna.confidence, confidence, 0.85) if facts else 0.1,
            warnings=warnings,
        ),
    )
