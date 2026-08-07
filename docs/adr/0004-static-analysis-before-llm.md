# ADR-0004: Static Analysis Before LLM

**Date:** 2026-08-07
**Status:** Accepted

---

## Problem

The first instinct when building an AI product is to pass raw data directly to an LLM and ask it to analyze everything. This approach has serious problems:

- LLMs hallucinate on structured data (package.json, CI configs)
- High token cost for data that doesn't need AI
- Hard to test — outputs are non-deterministic
- No baseline for measuring LLM improvement

---

## Decision

Introduce a **separate `@apex/analysis` package** for deterministic static analysis:

```
Raw Data (files, URLs, configs)
    ↓
@apex/analysis (StaticRepositoryAnalyzer)
    ↓
RepositorySummary (structured, deterministic)
    ↓
@apex/ai-core (agents convert to Insights)
```

The LLM only receives **Evidence** — pre-extracted structured facts — not raw files.

---

## Alternatives Considered

| Option                  | Reason Rejected                                        |
| ----------------------- | ------------------------------------------------------ |
| Pass raw files to LLM   | Expensive, hallucination-prone, non-deterministic      |
| Skip static analysis    | Misses 100% confidence signals (has Docker, has CI...) |
| Parse in agent directly | Mixing concerns — agents should reason, not parse      |

---

## Consequences

- ✅ Deterministic insights with 100% confidence from file presence
- ✅ Cheap — no API calls for structural facts
- ✅ Testable with pure unit tests (input/output)
- ✅ Clear benchmark: compare static vs LLM-enhanced analysis
- ✅ Reduces hallucination — LLM receives facts, not raw text
- ⚠️ Requires maintaining two layers (analysis + AI reasoning)
