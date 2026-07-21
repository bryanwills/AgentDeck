---
id: system.readme
title: AgentDeck Design System Workspace
description: Entry point for canonical design, specification, policy, validation, and handover sources.
category: Engineering
locale: en
canonical: true
status: stable
owner: Design system maintainers
reviewed: 2026-07-21
revision: 2026-07-21
source_of_truth: agentdeck-design-system/README.md
validators: [node scripts/build-design-system-viewer.mjs --check]
---

# AgentDeck Design System Workspace

This directory is the integration layer for AgentDeck design work. It does not replace domain sources of truth. It catalogs them, validates their frontmatter, supplies reader translations, and builds the GitHub Pages viewer.

"Design system" here means the whole designed surface of the product, not only its
visual language: how the system is built, what hardware it drives, which policies
bound it, and what evidence proves it works. Those documents already existed —
scattered across `docs/`, package roots, and platform directories. The catalog is
what makes them one system instead of a directory listing.

The layer a document belongs to is its `category`, and the viewer's rail is
generated from those values — so this table is the categories, not a second
taxonomy alongside them. Each layer answers one reader question.

| Layer (`category`) | Answers                              | Examples                                                                       |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
| Governance         | How do I work on this system?        | this README, the handover contract, `docs/agent-harness.md`                    |
| Foundations        | What is the visual language, and where does its material live? | `DESIGN.md`, `design/RESOURCES.md`                   |
| Architecture       | How does it work?                    | `docs/architecture.md`, `daemon.md`, `protocol.md`, `gateway-protocol.md`, `apme.md` |
| Specifications     | What must a given surface do?        | `hardware-compatibility.md`, `devices.md`, `esp32*.md`, `android*.md`, `plugin-conventions.md`, `streamdeck-layout.md`, `tui-dashboard.md` |
| Policy             | What are we allowed to ship?         | `appstore-feature-matrix.md`, `apple/APP_REVIEW_NOTES.md`, `RELEASING.md`      |
| Validation         | How do I prove it works?             | `docs/testing.md`, `design-lint-baseline.md`, `plugin-ulanzi/VERIFY.md`        |
| Reference          | Why is this absent, or named oddly?  | `docs/retired-surfaces.md`                                                     |

Two things are indexed rather than cataloged, because they are not documents:
**assets** (`design/brand/`, `design/fonts/`, `assets/`, generated masks) are read
from the real files by the builder, and the **viewer** (`viewer/`) is the shell
that renders all of it into `dist/`.

**Retired material does not stay in Specifications.** A layer that mixes what a
surface must do today with what it used to do stops answering its own question.
Removed capabilities are collected in the Reference layer — one document, with
the reason and the residue each removal left behind — and the current spec links
to it. Version numbers are not used to distinguish the two: the product has one
version (`VERSION`), and a second numbering alongside it only raises "v4 of
what?". See [Retired and Experimental Surfaces](../docs/retired-surfaces.md).

English is canonical. Korean and Japanese are reader translations. A translation must declare `translation_of` and `source_revision`; when it is missing or stale, the viewer falls back to English and says so.

## Coverage is enforced, not aspirational

`catalog.json` declares a `coverage` block: a list of scanned directories plus an
`exclusions` map. Every Markdown file in a scanned directory must be either
cataloged or excluded **with a stated reason**, and the build fails otherwise.
Fragmentation is rarely a decision — it is a document written next to the code
that never surfaced anywhere. This gate makes that impossible to do silently: a
new doc either joins the system or its absence is argued for in the same commit.

Excluding is a legitimate answer. Runbooks, credential setup, exploratory studies,
and untranslated rationale essays are excluded today, each with its reason in the
catalog.

**The user manual is excluded as a class.** `docs/install.md`, `cli.md`,
`configuration.md`, `apple-app.md`, `windows.md`, and `troubleshooting.md` tell a
reader how to *use* the product; this catalog documents how it is *designed and
specified*. Two audiences, two indexes — the manual is indexed by
[README](../README.md), and the thing each manual page describes (the CLI, the
settings schema, the tier boundary) is already cataloged here at its canonical
source. That is a deliberate split, not a gap.

## Adding a document

1. Add YAML frontmatter with all twelve required fields; the body starts with one H1.
2. Add a `catalog.json` entry whose `id` matches the frontmatter `id`.
3. Choose the `category` from the ones already in use — a new category creates a new
   rail group in the viewer, so add one only when the document genuinely does not
   belong to an existing layer.
4. Run `pnpm design-system:check`.

Build with `pnpm design-system:build`. Validate without keeping output with `pnpm design-system:check`.
