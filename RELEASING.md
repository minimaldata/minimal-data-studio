# Release policy

## Student baseline

The approved student baseline is **v0.4.0**, the Apple-notarized Mac release with bundled Python and R, external database connections, BigQuery models, full-result saving, DMG installation, and stable-channel in-app updates.

The permanent student entry point is https://minimaldata.github.io/minimal-data-studio/. Keep its download button and the README pinned to the approved baseline. Do not point student downloads at an automatically changing latest release URL.

## Future changes

- Development changes do not automatically trigger a student release.
- Builds for testing remain local or in GitHub draft releases by default. Published testing releases must be marked as prereleases and clearly labeled Preview.
- Do not replace the student baseline, update its download links, or promote a preview without Christian's explicit decision to publish it for students. Completing a feature, building, signing, or notarizing is not that authorization.
- Batch changes into deliberate releases. Important fixes can be promoted sooner with the same explicit decision.
- Give each release a new version. Never overwrite assets on an already published release.

## Promoting a release

After explicit approval: run the relevant tests, build and sign, obtain Apple's Accepted notarization result, staple and verify the final app, and create the DMG, updater ZIP, checksums, and signed stable appcast. Publish the versioned release and required third-party source archives before changing the website and README download links. Verify the assets and deployed page, then record the new baseline here.

Keep previous releases available and explain compatibility requirements. Version 0.2.0 and later use Sparkle through Help or the Mac app menu. Publish archives first, then the stable appcast and page links. Keep preview and stable feeds separate. Replacing the app must preserve project folders and user-selected runtimes.
