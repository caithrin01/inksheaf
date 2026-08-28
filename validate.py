#!/usr/bin/env python3
"""Inksheaf work validator.

Checks that the project's plan, launch plan, design brief and evidence agree
with each other and with the project's own rules. Documented in the vault:
05-Projects/Substack Magazine/validator.md

Usage:  python3 ~/repos/inksheaf/validate.py [--quiet]
Exit 0: no failures. Exit 1: at least one FAIL. Warnings never fail the run.
Stdlib only. Reads the vault; never writes to it.
"""
import json
import re
import sys
from pathlib import Path

VAULT = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Caithrin"
PROJ = VAULT / "05-Projects/Substack Magazine"
EVID = PROJ / "evidence"

REQUIRED_DOCS = [
    "Substack Magazine.md", "research.md", "plan.md", "lulu-setup.md",
    "naming.md", "launch-plan.md", "design-brief.md", "validator.md",
]

# Plan checklist task number -> evidence file that must exist before the task
# may be checked [x]. Filenames live in evidence/.
TASK_EVIDENCE = {
    6:  "interviews.md",
    7:  "beta-cohort.md",
    9:  "lulu-auth.md",
    10: "lulu-costs.json",
    11: "lulu-limits.md",
    13: "lulu-validation.md",
    14: "lulu-jobstate.md",
    15: "cover-direction.md",
    19: "renderer-decision.md",
    24: "proof-review.md",
    26: "dogfood-defects.md",
    27: "margin-model.md",
    35: "first-orders.md",
    36: "beta-metrics.md",
}

REQUIRED_SECTIONS = {
    "launch-plan.md": ["## Positioning", "## Audience", "## Channels", "## Calendar",
                       "## Assets", "## Metrics", "## Copy rules"],
    "design-brief.md": ["## The two-brand rule", "## Name and mark", "## Type", "## Colour",
                        "## Voice", "## Surfaces", "## Acceptance criteria"],
}

# Copy-facing docs where affiliation and unmeasured-price rules apply.
COPY_DOCS = ["launch-plan.md", "design-brief.md"]

AFFILIATION_PATTERNS = [
    r"partner(?:ed|ship)?\s+with\s+Substack",
    r"official\s+Substack",
    r"Substack['’]s\s+print",
    r"by\s+Substack\b",
    r"endorsed\s+by\s+Substack",
]

SECRET_PATTERNS = [
    (r"client_secret\s*[:=]\s*['\"]?[A-Za-z0-9]", "client_secret assignment"),
    (r"\bsk_(?:live|test)_[A-Za-z0-9]{8,}", "Stripe secret key"),
    (r"Bearer\s+[A-Za-z0-9_\-\.]{30,}", "bearer token"),
    (r"api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]{16,}", "api key assignment"),
]

fails, warns, passes = [], [], []


def fail(msg): fails.append(msg)
def warn(msg): warns.append(msg)
def ok(msg): passes.append(msg)


def read(name):
    p = PROJ / name
    return p.read_text(encoding="utf-8") if p.exists() else None


def check_docs_exist():
    missing = [d for d in REQUIRED_DOCS if not (PROJ / d).exists()]
    if missing:
        fail("missing project documents: " + ", ".join(missing))
    else:
        ok(f"all {len(REQUIRED_DOCS)} project documents present")


def check_sections():
    for doc, sections in REQUIRED_SECTIONS.items():
        text = read(doc)
        if text is None:
            continue
        missing = [s for s in sections if s not in text]
        if missing:
            fail(f"{doc}: missing required sections: {', '.join(missing)}")
        else:
            ok(f"{doc}: all {len(sections)} required sections present")


def check_secrets():
    hits = []
    for p in list(PROJ.glob("**/*.md")) + list(PROJ.glob("**/*.json")):
        text = p.read_text(encoding="utf-8", errors="replace")
        for pat, label in SECRET_PATTERNS:
            if re.search(pat, text):
                hits.append(f"{p.name}: {label}")
    if hits:
        fail("possible credentials in vault: " + "; ".join(hits))
    else:
        ok("no credential patterns in project files")


def check_subscriber_data():
    """No file in the project may carry lists of third-party email addresses."""
    hits = []
    for p in PROJ.glob("**/*.csv"):
        text = p.read_text(encoding="utf-8", errors="replace")
        emails = set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", text))
        emails.discard("caithrin@caithrin.com")
        if emails:
            hits.append(f"{p.relative_to(PROJ)} ({len(emails)} addresses)")
    if hits:
        fail("subscriber-like email data inside the vault: " + "; ".join(hits))
    else:
        ok("no CSV with third-party email addresses in the project")


def parse_checked_tasks(plan):
    """Return {task_number} for numbered checklist items marked [x]."""
    checked = set()
    for m in re.finditer(r"^\s*(\d+)\.\s*\[(x|X)\]", plan, re.M):
        checked.add(int(m.group(1)))
    return checked


def check_task_evidence():
    plan = read("plan.md")
    if plan is None:
        return
    checked = parse_checked_tasks(plan)
    bad = []
    for num, evname in sorted(TASK_EVIDENCE.items()):
        if num in checked and not (EVID / evname).exists():
            bad.append(f"task {num} is [x] but evidence/{evname} does not exist")
    if bad:
        for b in bad:
            fail("plan.md: " + b)
    else:
        gated_checked = [n for n in checked if n in TASK_EVIDENCE]
        ok(f"plan.md: {len(checked)} tasks checked; "
           f"{len(gated_checked)} evidence-gated, all satisfied")


def check_costs_schema():
    p = EVID / "lulu-costs.json"
    if not p.exists():
        warn("evidence/lulu-costs.json not yet present (required before tasks 10+ "
             "are checked and before any public price)")
        return
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"lulu-costs.json is not valid JSON: {e}")
        return
    rows = data.get("rows", [])
    pages_needed = {60, 132, 220, 300}
    dests_needed = {"west", "central", "east", "alaska", "hawaii"}
    pages = {r.get("pages") for r in rows}
    dests = {r.get("destination") for r in rows}
    problems = []
    if not pages_needed <= pages:
        problems.append(f"missing page counts {sorted(pages_needed - pages)}")
    if not dests_needed <= dests:
        problems.append(f"missing destinations {sorted(dests_needed - dests)}")
    for i, r in enumerate(rows):
        if not isinstance(r.get("total"), (int, float)):
            problems.append(f"row {i} has no numeric total")
            break
    if data.get("source") not in ("lulu-sandbox-api", "lulu-production-api"):
        problems.append('source must be a measured Lulu API (sandbox or production), not an estimate')
    if problems:
        fail("lulu-costs.json: " + "; ".join(problems))
    else:
        ok(f"lulu-costs.json: {len(rows)} measured rows, matrix complete")


def check_prices():
    """No dollar figure in copy-facing docs before measured costs exist."""
    costs_exist = (EVID / "lulu-costs.json").exists()
    for doc in COPY_DOCS:
        text = read(doc)
        if text is None:
            continue
        hits = []
        for m in re.finditer(r"\$\d[\d,.]*", text):
            line = text[text.rfind("\n", 0, m.start()) + 1:
                        text.find("\n", m.end())]
            if "expected" in line.lower() or "estimate" in line.lower():
                continue
            if costs_exist:
                continue
            hits.append(f"{m.group(0)}: {line.strip()[:70]}")
        if hits:
            fail(f"{doc}: dollar figures before measured costs: " + " | ".join(hits))
        else:
            ok(f"{doc}: no unmeasured price claims")


def check_affiliation():
    for doc in COPY_DOCS:
        text = read(doc)
        if text is None:
            continue
        hits = [pat for pat in AFFILIATION_PATTERNS
                if re.search(pat, text, re.I)]
        if hits:
            fail(f"{doc}: Substack-affiliation phrasing matches: {hits}")
        else:
            ok(f"{doc}: no affiliation-implying phrasing")


def check_caithrin_brand_leak():
    """The caithrin personal brand must not enter Inksheaf materials."""
    banned = [r"d20-(?:black|white|final|exact|tile)\.svg", r"dice-(?:bold|all)\.svg"]
    for doc in COPY_DOCS + ["lulu-setup.md"]:
        text = read(doc)
        if text is None:
            continue
        hits = [b for b in banned if re.search(b, text)]
        if hits:
            fail(f"{doc}: caithrin brand asset referenced: {hits}")
    ok("no caithrin brand assets referenced in Inksheaf docs")


def check_wikilinks():
    """Project-internal wiki-links must resolve to files."""
    dead = []
    for doc in REQUIRED_DOCS:
        text = read(doc)
        if text is None:
            continue
        for m in re.finditer(r"\[\[05-Projects/Substack Magazine/([^\]|#]+)", text):
            target = m.group(1).strip()
            if not ((PROJ / target).exists() or (PROJ / (target + ".md")).exists()):
                dead.append(f"{doc} -> {target}")
    if dead:
        warn("unresolved project wiki-links: " + "; ".join(sorted(set(dead))))
    else:
        ok("all project-internal wiki-links resolve")


def main():
    quiet = "--quiet" in sys.argv
    if not PROJ.exists():
        print(f"FAIL project folder not found: {PROJ}")
        return 1
    EVID.mkdir(exist_ok=True)
    for chk in (check_docs_exist, check_sections, check_secrets,
                check_subscriber_data, check_task_evidence, check_costs_schema,
                check_prices, check_affiliation, check_caithrin_brand_leak,
                check_wikilinks):
        chk()
    if not quiet:
        for p in passes:
            print("PASS", p)
    for w in warns:
        print("WARN", w)
    for f in fails:
        print("FAIL", f)
    print(f"\n{len(passes)} pass, {len(warns)} warn, {len(fails)} fail")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
