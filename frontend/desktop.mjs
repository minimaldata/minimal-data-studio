/** The only native-shell capability adapter. Browser mode remains fully supported. */
export async function configureUpdateLink(versionLabel, link, transport = fetch) {
  try {
    const response = await transport('/app-info');
    const info = response.ok ? await response.json() : null;
    if (info?.native_updater) {
      versionLabel.textContent = 'Studio ' + info.version;
      link.href = 'mds-studio://check-for-updates';
      link.removeAttribute('target');
    }
  } catch { /* Keep the ordinary website link in browser mode. */ }
}
