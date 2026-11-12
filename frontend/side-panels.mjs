/** Side-panel sizing and browser preferences. Editor refresh is injected. */
export function setupSidePanels({store, onLayout, document = globalThis.document}) {
  const $ = id => document.getElementById(id);
let explorerOpen = true; // Start expanded on every open; collapse only for this page session.
let helpOpen = store.get("helpOpen", false);
const panelWidths = {
  explorer: Math.max(180, Math.min(600, Number(store.get("explorerWidth", 240)) || 240)),
  help: Math.max(240, Math.min(600, Number(store.get("helpWidth", 320)) || 320))
};
function fitPanelWidths() {
  const available = document.querySelector("main").clientWidth - 280 -
    (explorerOpen ? 6 : 28) - (helpOpen ? 6 : 28);
  const total = (explorerOpen ? panelWidths.explorer : 0) + (helpOpen ? panelWidths.help : 0);
  const scale = total ? Math.min(1, Math.max(0, available) / total) : 1;
  for (const [which, open] of [["explorer", explorerOpen], ["help", helpOpen]]) {
    const width = Math.round(panelWidths[which] * scale);
    $(which + "Panel").style.flexBasis = width + "px";
    $(which + "Panel").style.width = width + "px";
    const handle = $(which + "Resize");
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "600");
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuetext", width + " pixels");
  }
}
function applySidePanels() {
  for (const [which, open] of [["explorer", explorerOpen], ["help", helpOpen]]) {
    $(which + "Panel").hidden = $(which + "Resize").hidden = !open;
    $(which + "Rail").hidden = open;
    $("toggle" + (which === "help" ? "Help" : "Explorer")).setAttribute("aria-expanded", String(open));
  }
  fitPanelWidths();
}
function refreshPanelLayout() {
  onLayout();
  dispatchEvent(new Event("resize"));
}
function changeSidePanels(which) {
  if (which === "explorer") explorerOpen = !explorerOpen;
  else helpOpen = !helpOpen;
  store.set("helpOpen", helpOpen);
  applySidePanels();
  requestAnimationFrame(refreshPanelLayout);
}
$("toggleExplorer").onclick = () => changeSidePanels("explorer");
$("toggleHelp").onclick = () => changeSidePanels("help");
$("closeExplorer").onclick = () => { changeSidePanels("explorer"); $("toggleExplorer").focus(); };
$("closeHelp").onclick = () => { changeSidePanels("help"); $("toggleHelp").focus(); };
for (const which of ["explorer", "help"]) {
  const handle = $(which + "Resize");
  const minimum = which === "explorer" ? 180 : 240;
  const resize = value => {
    // Respect the other panel's displayed size and leave room for the editor.
    const other = which === "explorer" ? "help" : "explorer";
    const otherOpen = other === "help" ? helpOpen : explorerOpen;
    const otherWidth = otherOpen ? $(other + "Panel").getBoundingClientRect().width : 28;
    const max = Math.max(0, Math.min(600, document.querySelector("main").clientWidth - 280 - 6 - otherWidth - (otherOpen ? 6 : 0)));
    panelWidths[which] = Math.max(Math.min(minimum, max), Math.min(max, value));
    if (otherOpen) panelWidths[other] = otherWidth;
    fitPanelWidths();
    onLayout();
  };
  handle.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = event.clientX, width = $(which + "Panel").getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging"); document.body.classList.add("resizing-panels");
    handle.onpointermove = move => resize(width + (move.clientX - start) * (which === "help" ? -1 : 1));
    const finish = () => {
      handle.onpointermove = null;
      handle.classList.remove("dragging"); document.body.classList.remove("resizing-panels");
      store.set("explorerWidth", panelWidths.explorer); store.set("helpWidth", panelWidths.help);
      refreshPanelLayout();
    };
    handle.onpointerup = finish;
    handle.onpointercancel = finish;
    handle.onlostpointercapture = finish;
  };
  handle.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const delta = (event.key === "ArrowRight" ? 20 : -20) * (which === "help" ? -1 : 1);
    resize($(which + "Panel").getBoundingClientRect().width + delta);
    store.set("explorerWidth", panelWidths.explorer); store.set("helpWidth", panelWidths.help);
    refreshPanelLayout();
  };
}
addEventListener("resize", fitPanelWidths);
applySidePanels();
document.querySelectorAll("[data-help]").forEach(section => {
  section.open = store.get("helpSection:" + section.dataset.help, false);
  section.addEventListener("toggle", () => store.set("helpSection:" + section.dataset.help, section.open));
});

}
