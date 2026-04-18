# App Store Connect Certificate + Provisioning Setup

Step-by-step guide to provision the Mac Installer Distribution certificate and macOS App Store provisioning profile that CI needs before the `apple-release.yml` `build-macos` job can be flipped from `if: false` → `if: true`.

> iOS is already working — the existing `APPLE_CERTIFICATE_BASE64`, `ASC_API_KEY_*`, and `IOS_PROVISIONING_PROFILE_BASE64` secrets cover the iOS job. This guide only adds the **macOS distribution** pieces.

---

## Prerequisites

- Apple Developer Program membership (paid — $99/year).
- Admin or App Manager role on the AgentDeck team in [App Store Connect](https://appstoreconnect.apple.com/).
- macOS machine with Xcode 16+ and the same Apple ID signed in.
- Bundle ID `bound.serendipity.agentdeck.dashboard` already registered in the Apple Developer portal (it is — iOS TestFlight uses it).

---

## Step 1 — Create the App Store Connect record (macOS)

Skip if already created.

1. Open [App Store Connect → My Apps](https://appstoreconnect.apple.com/apps).
2. Click **+** → **New App**.
3. Platforms: check **macOS** (if iOS record already exists, this adds a Mac version to it — "Add new platform" flow).
4. Name: **AgentDeck Dashboard** (30-char limit).
5. Primary Language: Korean or English (pick one; you can localize later).
6. Bundle ID: `bound.serendipity.agentdeck.dashboard` (the same one the `.app` ships with).
7. SKU: `agentdeck-dashboard-macos` (internal id, any unique string).
8. User Access: Full access.
9. Click **Create**.

The record starts in **"Prepare for Submission"** state. Metadata/screenshots come later; the record just needs to exist so the profile below can attach to it.

---

## Step 2 — Register the App Group identifier

Required because `apple/AgentDeck/Resources/AgentDeck.entitlements` declares `com.apple.security.application-groups = [group.bound.serendipity.agentdeck.dashboard]`.

1. Open [Apple Developer → Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).
2. Tab **App Groups** (top filter). Click **+**.
3. **Description**: `AgentDeck Dashboard Group`.
4. **Identifier**: `group.bound.serendipity.agentdeck.dashboard` (must match entitlements exactly).
5. Register.

Then link the group to the App ID:
1. Back to Identifiers → **App IDs** tab → find `bound.serendipity.agentdeck.dashboard` → click it.
2. Under **Capabilities**, enable **App Groups** if not already. Configure → check `group.bound.serendipity.agentdeck.dashboard`.
3. Save.

---

## Step 3 — Create the Mac Installer Distribution certificate

This is the certificate that signs the `.pkg` the App Store ingests. Separate from the "Apple Distribution" cert that signs the `.app` itself.

1. Open **Keychain Access** on your Mac.
2. Keychain Access menu → **Certificate Assistant** → **Request a Certificate from a Certificate Authority**.
3. **User Email Address**: your Apple ID email.
4. **Common Name**: `AgentDeck Mac Installer` (or anything meaningful).
5. **CA Email Address**: leave blank.
6. **Request is**: check **Saved to disk**. Next.
7. Save the `.certSigningRequest` file (CSR) somewhere you can find it.

Then upload the CSR to Apple:

1. [Apple Developer → Certificates, Identifiers & Profiles → Certificates](https://developer.apple.com/account/resources/certificates/list).
2. Click **+**.
3. Section **Production**: select **Mac Installer Distribution**. Continue.
4. Upload the `.certSigningRequest` from Keychain Access. Continue.
5. Download the resulting `.cer` file.
6. Double-click the `.cer` to install into Keychain Access. It should appear under **login** keychain with the private key (from the CSR) attached.

Verify the cert is usable:

```bash
security find-identity -p basic -v
# Look for a line like:
#   N) XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX "3rd Party Mac Developer Installer: Your Name (TEAMID)"
```

If the line shows `unavailable`, the private key isn't in the same keychain as the public cert — re-download the cert or re-import the `.p12` from a previous export.

---

## Step 4 — Create the macOS Provisioning Profile

1. [Apple Developer → Profiles](https://developer.apple.com/account/resources/profiles/list) → **+**.
2. **Distribution** section: select **Mac App Store**. Continue.
3. App ID: `bound.serendipity.agentdeck.dashboard`. Continue.
4. Select the **Apple Distribution** certificate (the one for signing the `.app`, not the Mac Installer one). Continue.
5. Profile Name: `AgentDeck macOS App Store Distribution`.
6. Generate. Download the `.provisionprofile` file.

Install it locally:

```bash
cp ~/Downloads/AgentDeck_macOS_App_Store_Distribution.provisionprofile \
   ~/Library/MobileDevice/Provisioning\ Profiles/
```

---

## Step 5 — Export the Mac Installer cert as `.p12`

GitHub Actions needs the cert + private key as a base64-encoded `.p12`.

1. Keychain Access → select the **3rd Party Mac Developer Installer** certificate.
2. Right-click → **Export "3rd Party Mac Developer Installer: …"**.
3. File Format: **Personal Information Exchange (.p12)**.
4. Save to `~/Desktop/mac-installer.p12`.
5. Set a strong password — save it in your password manager; CI needs it as the `APPLE_MAC_INSTALLER_CERT_PASSWORD` secret.

Base64-encode for GitHub Secrets:

```bash
base64 -i ~/Desktop/mac-installer.p12 | pbcopy
```

The base64 string is now on your clipboard.

---

## Step 6 — Upload secrets to GitHub

Go to [github.com/puritysb/AgentDeck/settings/secrets/actions](https://github.com/puritysb/AgentDeck/settings/secrets/actions) and add these secrets:

| Secret name | Value | Notes |
|---|---|---|
| `APPLE_MAC_INSTALLER_CERT_BASE64` | paste from `pbcopy` above | The `.p12` base64 |
| `APPLE_MAC_INSTALLER_CERT_PASSWORD` | password you set in Step 5 | Used to decrypt the `.p12` on the runner |
| `MACOS_PROVISIONING_PROFILE_BASE64` | `base64 -i ~/Library/MobileDevice/Provisioning\ Profiles/AgentDeck_macOS_App_Store_Distribution.provisionprofile \| pbcopy` | The profile from Step 4 |

Existing secrets stay as-is:
- `APPLE_CERTIFICATE_BASE64` / `APPLE_CERTIFICATE_PASSWORD` (the Apple Distribution cert — iOS also uses it for .app signing)
- `ASC_API_KEY_ID` / `ASC_ISSUER_ID` / `ASC_API_KEY_BASE64`
- `IOS_PROVISIONING_PROFILE_BASE64`

---

## Step 7 — Update `apple-release.yml`

Open `.github/workflows/apple-release.yml` and apply three edits to unblock the macOS job:

### 7a — Flip the guard

```diff
   build-macos:
-    if: false
+    if: true
     runs-on: macos-15
```

### 7b — Install the Mac Installer cert in the "Install Apple certificate" step

The existing step imports a single cert from `APPLE_CERTIFICATE_BASE64`. Add a second import for the Mac Installer cert just after:

```yaml
      - name: Install Apple certificate
        env:
          APPLE_CERTIFICATE_BASE64: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_MAC_INSTALLER_CERT_BASE64: ${{ secrets.APPLE_MAC_INSTALLER_CERT_BASE64 }}
          APPLE_MAC_INSTALLER_CERT_PASSWORD: ${{ secrets.APPLE_MAC_INSTALLER_CERT_PASSWORD }}
        run: |
          # (existing Apple Distribution cert import — unchanged)
          ...

          # NEW: Mac Installer Distribution cert
          INSTALLER_CERT_PATH=$RUNNER_TEMP/mac-installer.p12
          echo -n "$APPLE_MAC_INSTALLER_CERT_BASE64" | base64 --decode -o $INSTALLER_CERT_PATH
          security import $INSTALLER_CERT_PATH -P "$APPLE_MAC_INSTALLER_CERT_PASSWORD" \
            -A -t cert -f pkcs12 -k $KEYCHAIN_PATH
          security set-key-partition-list -S apple-tool:,apple: \
            -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
```

### 7c — Add macOS to the release job dependency

```diff
   release:
-    needs: [build-ios]
+    needs: [build-ios, build-macos]
```

---

## Step 8 — Verify `apple/ExportOptions-macOS.plist`

The existing file at `apple/ExportOptions-macOS.plist` already specifies the right method:

```xml
<key>method</key>
<string>app-store-connect</string>
<key>teamID</key>
<string>R22679GY5Z</string>
<key>signingStyle</key>
<string>automatic</string>
<key>signingCertificate</key>
<string>Apple Distribution</string>
```

Apple's `altool --upload-app` step will pick up the Mac Installer cert automatically because `signingStyle = automatic` + the cert is now in the signing keychain. No additional manual specification needed.

---

## Step 9 — Trigger a dry-run tag

```bash
git tag apple-v1.0.0-rc1
git push origin apple-v1.0.0-rc1
```

Watch the `Apple Release (TestFlight)` workflow in GitHub Actions. Both `build-ios` and `build-macos` should run. The first run often surfaces missing entitlement values or cert-chain issues — iterate on `-rc2`, `-rc3` until you see the green `Upload macOS to App Store Connect` step.

After the upload, App Store Connect shows the build under **TestFlight → macOS**. Install via TestFlight on your Mac (not the archived build directly — Gatekeeper will refuse unsigned dev archives).

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `security: SecKeychainItemImport: The specified item already exists in the keychain` | Duplicate cert from a prior CI run that didn't clean up | The existing Cleanup step deletes the keychain on `if: always()` — usually safe. If stuck, regenerate the cert on Apple Developer and re-upload. |
| `xcodebuild: error: No account for team "R22679GY5Z"` | Runner keychain missing the Apple Distribution cert | Check `APPLE_CERTIFICATE_BASE64` secret is set and base64 is clean (no newlines). |
| `altool: error: The packaged app bundle is missing a Mach-O executable` | Archive was skipped (xcodebuild archive failed silently) | Scroll earlier in the log. The Archive step must emit `ARCHIVE SUCCEEDED`. |
| `altool: error: ITMS-90296: App sandbox not enabled` | Missing `com.apple.security.app-sandbox` | It IS in our entitlements file. Check `verify-appstore-archive.sh` output for the signed .app. |
| `altool: error: ITMS-90237: Apple Installer Package not signed` | Mac Installer cert didn't make it into the signing keychain | Verify the new import step in Step 7b ran. Look for "Mac Installer" in the "Install Apple certificate" step output. |
| TestFlight shows "Missing Compliance" banner | Standard cryptographic-use question | App Store Connect → TestFlight build → Export Compliance → answer "No" (AgentDeck doesn't ship custom cryptography beyond what macOS provides). |

---

## What can the user skip?

- **Mac Installer Distribution cert + provisioning profile**: Required for Mac App Store. Cannot skip.
- **App Group registration (Step 2)**: Required — our entitlements reference it. Cannot skip.
- **App Store Connect record creation (Step 1)**: Required before you can upload.
- **Metadata (icons, screenshots, description)**: Can be filled in App Store Connect after the first successful TestFlight upload. See [appstore-metadata-draft.md](appstore-metadata-draft.md) for copy.

Once Steps 1–7 are done once, subsequent releases just need `git tag apple-v1.X.Y && git push origin apple-v1.X.Y`.
