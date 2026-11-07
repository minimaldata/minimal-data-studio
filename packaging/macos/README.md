# Mac preview

Download the Apple Silicon ZIP from the GitHub release, unzip, move the app to Applications, and open it. Choose a writable project folder. Python, DuckDB, pandas, PyArrow, and matplotlib are included; there is no terminal setup step. R is optional and configured in Help. Keep the launcher running while using Studio, and quit it when finished.

Requires an Apple Silicon Mac and macOS 12 or newer; tested on macOS 26.5.2. Older supported versions still need testing. The published alpha.2 download is Developer ID signed, notarized, and stapled. Older copies of alpha.2 must be downloaded again to receive the notarized build. See [Apple’s launch-message guidance](https://support.apple.com/en-us/102445) if macOS blocks the first launch. Managed classroom computers may require an administrator.

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

Project files require alpha.2 or newer. In Help, use the small Check for updates link to visit the download page.

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
python3 packaging/macos/finalize_notarization.py --version 0.1.0-alpha.2
```

The finalizer retrieves Apple's log, staples and validates the ticket, verifies signatures and Gatekeeper acceptance, then recreates the ZIP and checksum. Review `build/signed/notary-log.json` for warnings. Publish only this final archive and matching checksum, and update the guide/release notes only after acceptance. The signed candidate is intentionally retained for inspection; move an old candidate aside before signing a new build.
