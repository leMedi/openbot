# Domain Docs

Engineering skills must consume the repository's domain documentation before exploring or changing the codebase.

## Before Exploring

- Read the root `CONTEXT.md`.
- Read relevant decisions under `docs/adr/`.
- If either location is absent, proceed silently.

## Layout

This repository uses a single context:

```text
/
|-- CONTEXT.md
|-- docs/adr/
|-- apps/
`-- packages/
```

`CONTEXT.md` defines the shared product and domain model. `docs/adr/` contains system-wide architecture decisions.

## Vocabulary

Use domain concepts as named in `CONTEXT.md`. Do not silently introduce synonyms. Note genuine vocabulary gaps for later domain modeling.

## ADR Conflicts

If proposed work contradicts an existing ADR, identify the conflict explicitly instead of silently overriding the decision.
