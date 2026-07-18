---
id: system.readme
title: AgentDeck Design System Workspace
description: Entry point for canonical design, specification, policy, validation, and handover sources.
category: Governance
locale: en
canonical: true
status: stable
owner: Design system maintainers
reviewed: 2026-07-18
revision: 2026-07-18
source_of_truth: agentdeck-design-system/README.md
validators: [node scripts/build-design-system-viewer.mjs --check]
---

# AgentDeck Design System Workspace

This directory is the integration layer for AgentDeck design work. It does not replace domain sources of truth. It catalogs them, validates their frontmatter, supplies reader translations, and builds the GitHub Pages viewer.

| Layer                  | Location                                                       | Role                                                         |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Visual language        | `DESIGN.md`, `design/`                                         | Canonical principles, tokens, components, and assets         |
| Hardware specification | `docs/hardware-compatibility.md`                               | Canonical device and compatibility data                      |
| Product policy         | `apple/APP_REVIEW_NOTES.md`, `docs/appstore-feature-matrix.md` | Review rationale and tier boundaries                         |
| Validation             | `docs/testing.md`, `.github/workflows/design-system.yml`       | Evidence expectations and drift gates                        |
| Handover               | `agentdeck-design-system/docs/handover.md`                     | Agent workflow and ownership map                             |
| Viewer                 | `agentdeck-design-system/viewer/`                              | Static application shell; generated content lives in `dist/` |

English is canonical. Korean and Japanese are reader translations. A translation must declare `translation_of` and `source_revision`; when it is missing or stale, the viewer falls back to English and says so.

Build with `pnpm design-system:build`. Validate without keeping output with `pnpm design-system:check`.
