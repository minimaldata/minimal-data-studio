# Mac preview

Download the Apple Silicon ZIP from the GitHub release, unzip, move the app to Applications, and open it. Choose a writable project folder. Python, DuckDB, pandas, PyArrow, and matplotlib are included; there is no terminal setup step. R is optional and configured in Help. Keep the launcher running while using Studio, and quit it when finished.

Requires an Apple Silicon Mac and macOS 12 or newer; tested on macOS 26.5.2. Older supported versions still need testing. The app is ad-hoc signed, not notarized. Follow [Apple’s Open Anyway guidance](https://support.apple.com/en-us/102445) if macOS blocks the first launch. Managed classroom computers may require an administrator.

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
