# AgentDeck App Store submission package

This directory contains the assets that are safe to upload to App Store Connect.

## Upload order

| Platform | Files | Apple slot |
|---|---:|---|
| macOS | 3 | Mac, 2880×1800 |
| iPhone | 3 | 6.5-inch, 1284×2778 |
| iPad | 3 | 13-inch, 2064×2752 |

The macOS images are privacy-safe captures of Device Preview, on-device APME settings, and opt-in Swift integrations. The iPhone set shows the value proposition, a live multi-agent dashboard, and an attention request. The iPad set shows the full dashboard, its focused permission state, and the distraction-free aquarium view. All are actual app UI captured from the current build with deterministic sample sessions, a normalized 9:41 status bar, English UI, and opaque PNG output. No image contains a developer-daemon-only panel or real user/session data.

Do not upload images from `apple/appstore-screenshots/`. That directory is a raw historical capture archive and contains duplicate onboarding frames, developer desktops, browser windows, local project names, IP addresses, and device paths.

## Metadata and review material

- Copy-ready Korean and English fields: `docs/appstore-metadata-draft.md`
- Reviewer notes: `apple/APP_REVIEW_NOTES.md`
- Privacy manifest: `apple/AgentDeck/Resources/PrivacyInfo.xcprivacy`
- Feature boundary: `docs/appstore-feature-matrix.md`
- TestFlight QA: `docs/testflight-qa-checklist.md`
- Submission decisions and remaining manual steps: `apple/appstore-submission/SUBMISSION_CHECKLIST.md`
- Optional video plan: `apple/appstore-submission/APP_PREVIEW_STORYBOARD.md`

Run validation before every upload:

```bash
bash apple/scripts/validate-appstore-submission.sh
```

For privacy-safe dashboard captures, run `node scripts/appstore-screenshot-mock.mjs`,
set the Simulator app preference `prefs.hasSeenOnboarding` to `YES`, then launch
a Debug Simulator build with `-AgentDeckScreenshotURL ws://127.0.0.1:9220/dashboard`
or `/attention`.
The Debug-only launch argument bypasses mDNS so a developer daemon cannot leak
real session data into the images. Neither the helper nor the launch path is
included in Release/App Store builds.

Add `--network` to verify the public URLs as well.

App Preview videos are optional. Do not delay the first release for one; the three screenshots per platform satisfy the required product-page media minimum. Never include Terminal, Xcode, browser chrome, secrets, real project names, or local network addresses.
