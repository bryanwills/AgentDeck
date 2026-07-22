# Email to Ulanzi support

Two things have to go through this channel, so they go in one message:

1. **Marketplace listing is manual.** Per support (2026-07-20), uploading through
   작품 업로드 only parks an entry in 내 업로드; a person at Ulanzi publishes it after
   you email them with the file ID and a use case.
2. **We cannot delete or edit our own entry.** Everything on the `*AuditResources`
   branch 404s, so the entry is frozen with its first-draft images. Only Ulanzi
   can clear it. Evidence is in `LISTING.md`; the short version is in the mail.

Asking them to delete (rather than publish as-is) is deliberate: the current
entry carries the old media, and the reworked cover/banners in `1.0.0/` are
better. One human touch resolves both.

- **To:** ustudioservice@ulanzi.com
- **Subject:** Please delete upload #1064 (AgentDeck) — blocked by a 404 on removeAuditResources

---

Hello,

I uploaded a D200H plugin to UlanziStudio and I need help with it, because I
cannot modify or delete it myself.

**The entry**

- Upload ID: 1064
- Name: AgentDeck
- Version: 1.0.0
- Unique ID: com.ulanzi.ulanzistudio.agentdeck
- Type / category: Plugin / Tools
- Main file (as stored): 659ac84fa3d24ce4aba7b246c6f3d945.zip
- Uploaded: 2026-07-20 14:05:18, status 0

**What I would like**

Please delete this entry. I want to re-upload version 1.0.1 with corrected cover
and banner images, and then ask you to publish that replacement on the Marketplace.

**Why I cannot do it myself**

Both the edit and delete buttons fail silently in 내 업로드. The frontend picks a
different endpoint depending on whether an entry is in the audit state, and the
backend appears to serve only one side of that split:

| Action | Endpoint called | Response |
|---|---|---|
| Edit (normal) | `/api/api/updateResources` | 200 |
| Edit (audit) | `/api/api/updateAuditResources` | **404** |
| Delete (normal) | `/api/api/removeResources` | 200 |
| Delete (audit) | `/api/api/removeAuditResources` | **404** |

My entry takes the audit branch, so it is frozen. A few notes that may save your
team time:

- It reproduces on a freshly loaded page with no edits at all, so it is not
  payload-related.
- The JS bundle is current (`index-7TL9tKSN.js` matches a fresh fetch), so it is
  not a stale client on my side.
- Every other endpoint responds normally: `userInfo`, `myList`, `cateList`,
  `dictData`, `upload`, `saveResources`, `updateResources`, `removeResources`.
- The 404 is a plain HTTP 404, not an application-level error message.

So the whole `*AuditResources` family looks absent from the deployed backend
rather than any single route being broken.

**About the plugin, for when I re-upload**

AgentDeck turns the D200H into a live control surface for AI coding agents
(Claude Code, Codex, OpenCode, OpenClaw). Each key is a session: it shows the
agent, the project, and whether that session is working, waiting on you, or idle,
and repaints itself as the state changes. Bottom-row keys carry quota gauges, and
pressing a key opens that session's detail view.

Use case: developers now run several coding agents at once, and the costly moment
is not the work — it is failing to notice that an agent has stopped and is waiting
for an answer. Buried in terminal tabs that state is invisible; on the D200H it is
a glanceable wall of keys.

The plugin ships a single dynamic action, so the user fills their keys with it and
each key assigns itself. It bundles no daemon, does not access USB HID directly,
and collects no analytics — it talks only to a local AgentDeck instance on the
user's own machine.

- Supported device: D200H
- Supported systems: Windows, macOS (Apple Silicon), macOS (Intel)
- Listing languages: English, 한국어, 日本語, 简体中文, Deutsch, Português, Español
- Project page: https://puritysb.github.io/AgentDeck/
- Source: https://github.com/puritysb/AgentDeck

Once #1064 is removed I will upload the final build and reply with the new upload
ID so you can review it for the Marketplace.

Thank you,
Serendipity Bound (admin@foundby.kr)

---

## After they reply

Status on 2026-07-22: #1064 is gone and the corrected 1.0.1 ZIP, form, and media
were submitted after the main-file uploader began working. AgentDeck appears in
`Works under review`, but its `/contentView/32` link displays the unrelated
`Douyin Live Studio` Profile. A second follow-up was sent in the same thread
with the reproduction URL and AgentDeck UUID/category, asking Ulanzi to confirm
the review entry is mapped correctly and cannot affect the unrelated work.

1. Confirm #1064 is gone from 내 업로드. **Done 2026-07-22.**
2. Upload `dist/com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin.zip`, then reuse
   the final images from `1.0.1/` — **one image at a time**, confirming each 이미지 자르기 dialog; a
   thumbnail is not proof the file reached the server (see LISTING.md). **Done
   2026-07-22.**
3. Set the version to `1.0.1` and 작성자 to `admin@foundby.kr` (shared across all
   seven locales).
4. Record the generated content route. Current route: `/contentView/32`
   (reported because it resolves to the wrong work).
5. Reply to the same thread with the route and the `ulanzi-v1.0.1` GitHub
   release URL to request Marketplace publication. **Done 2026-07-22; awaiting
   mapping confirmation.**
