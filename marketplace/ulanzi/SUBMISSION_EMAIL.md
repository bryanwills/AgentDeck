# Marketplace listing request — email to Ulanzi

Ulanzi does not publish user uploads automatically. Per support (2026-07-20), an
entry sitting in 내 업로드 reaches the Marketplace only after you email them and a
person reviews it. Send the message below **after** the upload exists, so the
file name in it resolves.

- **To:** ustudioservice@ulanzi.com
- **Subject:** Marketplace listing request — AgentDeck (D200H plugin, v1.0.0)

English, since the support address is the international one. Fill in the two
bracketed values from the portal before sending.

---

Hello,

I have uploaded a plugin to UlanziStudio and would like to request that it be
published on the Marketplace.

**Upload details**

- Name: AgentDeck
- Unique ID: com.ulanzi.ulanzistudio.agentdeck
- Version: 1.0.0
- Type / category: Plugin / Tools
- Upload ID: [fill in from 내 업로드]
- Main file: [fill in the .zip name shown in the portal]
- Supported device: D200H
- Supported systems: Windows, macOS (Apple Silicon), macOS (Intel)
- Supported languages: English, 한국어, 日本語, 简体中文, Deutsch, Português, Español

**What it does**

AgentDeck turns the D200H into a live control surface for AI coding agents
(Claude Code, Codex, OpenCode, OpenClaw). Each key is a session: it shows the
agent, the project, and whether that session is working, waiting on you, or idle,
and it repaints itself as the state changes. The bottom-row keys carry
subscription quota gauges. Pressing a key opens that session's detail view.

**Use case**

Developers increasingly run several coding agents at once, and the expensive
moment is not the work — it is noticing that an agent has stopped and is waiting
for an answer. That state is invisible when it is buried in terminal tabs. On the
D200H it is a glanceable wall of keys, so the deck earns its desk space for
anyone doing agent-assisted development.

The plugin ships a single dynamic action; the user fills their keys with it and
each key assigns itself. It does not bundle a daemon, does not access USB HID
directly, and collects no analytics. It talks only to a local AgentDeck instance
on the user's own machine.

**Links**

- Project page: https://puritysb.github.io/AgentDeck/
- Source: https://github.com/puritysb/AgentDeck

Please let me know if you need anything else — a different asset ratio, extra
screenshots, or a signed build.

Thank you,
Serendipity Bound (admin@foundby.kr)

---

## Note on the 404

If they ask why the entry was re-uploaded rather than edited: editing an existing
upload fails because the frontend posts to `/api/api/updateAuditResources`, which
returns HTTP 404, while `/api/api/updateResources` exists. Worth reporting in the
same thread — see the blocker section in `LISTING.md` for the full evidence.
