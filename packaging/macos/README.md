# Mac preview

Open the Apple Silicon DMG, drag Studio onto Applications, eject the image, and launch Studio from Applications. Choose a writable project folder. Python, DuckDB, pandas, PyArrow, matplotlib, R 4.6.2, its recommended packages, and nanoparquet are included; there is no terminal setup step. Help lets you select your own Python or R installation. Keep the launcher running while using Studio, and quit it when finished.

Requires an Apple Silicon Mac and macOS 14 or newer; tested on macOS 26.5.2. Older supported versions still need testing. Published downloads are Developer ID signed, notarized, and stapled. Alpha.3 adds bundled R and requires macOS 14; alpha.2 remains available for older Macs. See [Apple’s launch-message guidance](https://support.apple.com/en-us/102445) if macOS blocks the first launch. Managed classroom computers may require an administrator.

Project files and database live in your chosen folder, outside the app. Back up that entire folder, including hidden files, after quitting. Saved queries persist; unsaved tabs and UI preferences are browser-local and may not carry over when the launch URL changes. Internet is required for frontend CDN assets. This is an early preview for testing before classroom rollout.

## Build

On the target Mac architecture with Xcode Command Line Tools and Python 3 installed:

```sh
python3 packaging/macos/build.py
```

The script downloads a pinned, SHA-256 verified portable Python, installs pinned binary wheels, compiles the Swift launcher and logo icon, ad-hoc signs the bundle, and writes a ZIP and checksum to `dist/`. No Apple developer account is needed. Network access is required. Build directories are ignored by Git. The source allowlist excludes development environments, project data, local database files, and Git history. Upstream runtime and package licenses are retained in the bundle.

The builder supports native arm64 and x86_64 hosts, but only arm64 has been built and tested for this release. Do not label an Intel build validated until it has been tested on Intel hardware.

```sh
python3 packaging/macos/smoke.py "build/macos/Minimal Data Studio.app"
```

The smoke check copies the app to a temporary location, verifies its signature, starts its bundled server against a temporary project, exercises SQL and Python, and checks database persistence across restart. It never uses your working project.

## Project files

Each project gets an `Open Project.mdsproject` file in its root folder. With the updated Mac app installed, double-click this file to start Studio for that folder and open its browser workspace. Opening the same project again reopens the browser without restarting its server; opening a different project switches the launcher to that project.

The marker contains a format/version identifier, not an absolute path or a server URL. You can rename it and move the complete project folder. Keep it alongside your data: copying the marker alone does not copy your project. Existing projects get a marker the next time they start with the updated server. Existing valid markers are reused and unrelated files are never overwritten.

Project files require alpha.2 or newer. In native builds, Help and the Mac app menu open Sparkle. In development, Help links to the download page.

## Developer ID signing and notarization

Release signing requires a valid Developer ID Application identity in Keychain and a `notarytool` credential profile. Create/store credentials interactively in your own terminal; never put passwords or private keys in this repository. Signing material belongs outside the checkout. The ordinary builder remains suitable for local ad-hoc previews.

After building, create a separate hardened-runtime candidate:

```sh
python3 packaging/macos/sign.py --identity 'Developer ID Application: YOUR NAME (TEAMID)'
python3 packaging/macos/smoke.py 'build/signed/Minimal Data Studio.app'
ditto -c -k --sequesterRsrc --keepParent 'build/signed/Minimal Data Studio.app' build/signed/notarization.zip
xcrun notarytool submit build/signed/notarization.zip --keychain-profile minimal-data-studio --output-format json > build/signed/submission.json
```

Save the returned submission ID and check it with `xcrun notarytool info ID --keychain-profile minimal-data-studio`. Do not resubmit merely because processing is slow. After Apple reports **Accepted**:

```sh
python3 packaging/macos/finalize_notarization.py --version 0.1.0-alpha.3
```

The finalizer retrieves Apple's log, staples and validates the ticket, verifies signatures and Gatekeeper acceptance, then recreates the ZIP and checksum. Review `build/signed/notary-log.json` for warnings. Publish only this final archive and matching checksum, and update the guide/release notes only after acceptance. The signed candidate is intentionally retained for inspection; move an old candidate aside before signing a new build.

## Bundled R build

`bundle_r.py` downloads checksum-pinned official R 4.6.2 and nanoparquet 0.5.2 binaries, extracts without installing, and rewrites native library paths relative to the bundle. The runtime excludes optional X11/Cairo/Tcl interfaces, preserves upstream license files, and uses Quartz for plots. The package smoke test denies access to system R, /opt/R, and /opt/X11 and exercises R tables and plots from a relocated app. Native Intel builds are not enabled for the bundled-R release.

## DMG and in-app updates

The Mac package includes Sparkle 2.10.1. Build defaults to the **preview**
feed; it does not publish anything. The native app menu and browser Help can
open the updater. The first launch outside Applications offers to install there;
replacement asks explicitly and moves the old installed copy to Trash. The DMG
contains an Applications shortcut and a Finder icon layout for drag installation.

`updates.json` pins Sparkle, its SHA-256, the public update key, and feed URLs.
The corresponding private key lives in the login Keychain, not the repository.
The build-only Finder layout dependency is installed into `build/packaging-tools`.

```sh
python3 packaging/macos/build.py --channel preview --version 0.2.0-preview.1 --build-number 4
# When explicitly approved as a student release, use an increasing build number:
python3 packaging/macos/build.py --channel stable --version 0.2.0 --build-number 5
```

Use a unique, increasing build number for every published candidate. Never put
preview archives in the stable feed. A prerelease version is rejected for stable
builds. No silent installation: Sparkle asks the user, and Studio also reminds
them to save browser code and finish running queries before restarting. Choosing
Return to my work defers installation; Check for Updates reopens the reminder.
The launcher remembers the current project and stops its server on termination.
This does **not** automatically save unsaved browser editor tabs.

Sign and notarize the app using the existing workflow. Finalization now also
creates a DMG from the stapled app. Sign that DMG with Developer ID, submit it
with notarytool, then staple and validate the DMG after acceptance. Do not publish
an ad-hoc local preview or a pending/rejected notarization submission.

Stage a signed update feed from the accepted, stapled app:

```sh
python3 packaging/macos/prepare_update.py \
  --app 'build/signed/Minimal Data Studio.app' \
  --tag v0.2.0 --notes path/to/release-notes.md
```

This verifies the app and creates a fresh ZIP directly from it, then calls
Sparkle's `generate_appcast` to sign the update archive and embed release notes.
Output stays under `dist/updates/<channel>/<tag>/`; it is not published. Upload
that exact ZIP to the matching GitHub Release, plus the notarized DMG for manual
installation. Only after checking the release downloads, copy the reviewed XML
to `site/updates/<channel>.xml` and publish Pages. Preview releases should also
be marked prerelease on GitHub. The two initial feed files contain no updates.

Before the first public release, test an actual older-to-newer **signed** install
on the preview feed, including postponing restart, project reopening, and
running from Applications. Source builds and typechecking alone do not validate
Sparkle's downloaded-update replacement and relaunch path.
