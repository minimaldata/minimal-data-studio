import Cocoa
import WebKit

private final class ProjectWindowMessages: NSObject, WKScriptMessageHandler {
    weak var owner: ProjectWindowController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { owner?.handle(message) }
}

/// One retained workspace per canonical project path. Hiding a window never stops
/// its server or discards editor state. The launcher owns server lifetime.
final class ProjectWindowController: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSToolbarDelegate {
    let window: NSWindow
    let web: WKWebView
    private(set) var address: URL
    private(set) var reloadPending = false
    private let project: String
    private let projectsItem = NSToolbarItem.Identifier("studio.projects")
    private let browserItem = NSToolbarItem.Identifier("studio.browser")
    private let showManager: () -> Void
    private let checkUpdates: () -> Void
    private let chooseProject: () -> Void
    private let newProject: () -> Void

    init(project: String, address: URL, showManager: @escaping () -> Void, checkUpdates: @escaping () -> Void, chooseProject: @escaping () -> Void, newProject: @escaping () -> Void) {
        self.project = project
        self.address = address; self.showManager = showManager; self.checkUpdates = checkUpdates
        self.chooseProject = chooseProject; self.newProject = newProject
        web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:1200,height:800), styleMask:[.titled,.closable,.miniaturizable,.resizable], backing:.buffered, defer:false)
        super.init()
        window.title = URL(fileURLWithPath:project).lastPathComponent + " — Minimal Data Studio"
        window.minSize = NSSize(width:800,height:500)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("StudioProjectWorkspace")
        web.navigationDelegate = self; web.uiDelegate = self
        let messages = ProjectWindowMessages(); messages.owner = self
        web.configuration.userContentController.add(messages,name:"studioProject")
        web.configuration.userContentController.addUserScript(WKUserScript(source:"""
            document.addEventListener('click', event => {
              const button = event.target.closest?.('#openProjectBtn, #newProjectBtn');
              if (!button || button.disabled) return;
              event.preventDefault(); event.stopImmediatePropagation();
              window.webkit.messageHandlers.studioProject.postMessage(button.id);
            }, true);
            """,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        window.contentView = web
        let toolbar = NSToolbar(identifier:"StudioWorkspaceToolbar")
        toolbar.delegate = self; toolbar.displayMode = .iconOnly; toolbar.allowsUserCustomization = false
        window.toolbar = toolbar; window.toolbarStyle = .unifiedCompact
        window.center()
        web.load(URLRequest(url:address))
    }
    func toolbarAllowedItemIdentifiers(_ toolbar:NSToolbar)->[NSToolbarItem.Identifier] { [projectsItem,.flexibleSpace,browserItem] }
    func toolbarDefaultItemIdentifiers(_ toolbar:NSToolbar)->[NSToolbarItem.Identifier] { toolbarAllowedItemIdentifiers(toolbar) }
    func toolbar(_ toolbar:NSToolbar,itemForItemIdentifier identifier:NSToolbarItem.Identifier,willBeInsertedIntoToolbar flag:Bool)->NSToolbarItem? {
        guard identifier == projectsItem || identifier == browserItem else { return nil }
        let item = NSToolbarItem(itemIdentifier:identifier)
        let projects = identifier == projectsItem
        item.label = projects ? "Projects" : "Open in browser"
        item.toolTip = projects ? "Show project manager" : "Open this project in your browser"
        item.image = NSImage(systemSymbolName:projects ? "sidebar.left" : "arrow.up.forward.app",accessibilityDescription:item.label)
        item.target = self; item.action = projects ? #selector(openManager) : #selector(openBrowser)
        return item
    }
    func reloadWorkspace() {
        guard !reloadPending else { return }
        reloadPending = true
        window.subtitle = "Saving before reload…"
        web.callAsyncJavaScript("return typeof window.studioPrepareReload === 'function' ? await window.studioPrepareReload() : {ok:false,error:'The reload safety check is not available yet. Save your work and reopen the preview app to load it.'};",arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self = self else { return }
            self.reloadPending = false; self.window.subtitle = ""
            if case .success(let value) = result, let reply = value as? [String:Any], reply["ok"] as? Bool == true {
                self.web.reload(); return
            }
            self.web.evaluateJavaScript("window.studioCancelReload?.()",completionHandler:nil)
            let alert = NSAlert(); alert.messageText = "Workspace was not reloaded"
            if case .success(let value) = result, let reply = value as? [String:Any], let error = reply["error"] as? String { alert.informativeText = error }
            else { alert.informativeText = "The interface could not confirm that your work is saved. Save or copy unsaved edits before reopening the workspace." }
            alert.beginSheetModal(for:self.window,completionHandler:nil)
        }
    }
    func showInFinder() { NSWorkspace.shared.selectFile(nil,inFileViewerRootedAtPath:project) }
    func setAppearance(_ mode:String) {
        guard ["light","dark","system"].contains(mode) else { return }
        window.appearance = mode == "system" ? nil : NSAppearance(named:mode == "dark" ? .darkAqua : .aqua)
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('studio-appearance', {detail: '\(mode)'}))",completionHandler:nil)
    }
    func open(address: URL) {
        // A server restart may change the port. Do not silently reload a live editor.
        if !Self.isProjectURL(address,address:self.address) {
            let alert = NSAlert(); alert.messageText = "Reconnect this project?"
            alert.informativeText = "The project's server address changed. Copy any unsaved work before reconnecting."
            alert.addButton(withTitle:"Reconnect"); alert.addButton(withTitle:"Keep window")
            if alert.runModal() == .alertFirstButtonReturn { self.address = address; web.load(URLRequest(url:address)); window.subtitle = "" }
        }
        window.deminiaturize(nil); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }
    fileprivate func handle(_ message:WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              Self.isProjectURL(url,address:address), let action = message.body as? String else { return }
        if action == "openProjectBtn" { chooseProject() }
        if action == "newProjectBtn" { newProject() }
    }
    @objc private func openManager() { showManager() }
    @objc func openBrowser() { NSWorkspace.shared.open(address) }

    static func isProjectURL(_ url: URL, address: URL) -> Bool {
        url.scheme == address.scheme && url.host == address.host && url.port == address.port && url.user == nil && url.password == nil
    }
    private func openExternal(_ url:URL) {
        if url.scheme == "mds-studio", url.host == "check-for-updates" { checkUpdates() }
        else if ["https","http","mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
    }
    func webView(_ webView:WKWebView, decidePolicyFor navigationAction:WKNavigationAction, decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if Self.isProjectURL(url,address:address) || url.scheme == "blob" {
            decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
        } else {
            // Remote content never replaces the trusted local workspace.
            if navigationAction.navigationType == .linkActivated { openExternal(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView:WKWebView, createWebViewWith configuration:WKWebViewConfiguration, for navigationAction:WKNavigationAction, windowFeatures:WKWindowFeatures)->WKWebView? {
        if let url = navigationAction.request.url { openExternal(url) }; return nil
    }
    func webView(_ webView:WKWebView, decidePolicyFor navigationResponse:WKNavigationResponse, decisionHandler:@escaping(WKNavigationResponsePolicy)->Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView:WKWebView, navigationAction:WKNavigationAction, didBecome download:WKDownload) { download.delegate = self }
    func webView(_ webView:WKWebView, navigationResponse:WKNavigationResponse, didBecome download:WKDownload) { download.delegate = self }
    func download(_ download:WKDownload, decideDestinationUsing response:URLResponse, suggestedFilename:String, completionHandler:@escaping(URL?)->Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath:suggestedFilename).lastPathComponent
        panel.beginSheetModal(for:window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download:WKDownload, didFailWithError error:Error, resumeData:Data?) {
        if (error as NSError).code != NSURLErrorCancelled { window.subtitle = "Download failed. Try again or open in browser." }
    }
    func webView(_ webView:WKWebView, runOpenPanelWith parameters:WKOpenPanelParameters, initiatedByFrame frame:WKFrameInfo, completionHandler:@escaping([URL]?)->Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories; panel.canChooseFiles = true
        panel.beginSheetModal(for:window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView:WKWebView, runJavaScriptAlertPanelWithMessage message:String, initiatedByFrame frame:WKFrameInfo, completionHandler:@escaping()->Void) {
        let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for:window) { _ in completionHandler() }
    }
    func webView(_ webView:WKWebView, runJavaScriptConfirmPanelWithMessage message:String, initiatedByFrame frame:WKFrameInfo, completionHandler:@escaping(Bool)->Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle:"Continue"); alert.addButton(withTitle:"Cancel")
        alert.beginSheetModal(for:window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView:WKWebView, runJavaScriptTextInputPanelWithPrompt prompt:String, defaultText:String?, initiatedByFrame frame:WKFrameInfo, completionHandler:@escaping(String?)->Void) {
        let alert = NSAlert(); alert.messageText = prompt; let input = NSTextField(string:defaultText ?? ""); input.frame = NSRect(x:0,y:0,width:320,height:24); alert.accessoryView = input
        alert.addButton(withTitle:"OK"); alert.addButton(withTitle:"Cancel"); alert.beginSheetModal(for:window) { completionHandler($0 == .alertFirstButtonReturn ? input.stringValue : nil) }
    }
    func webView(_ webView:WKWebView, didFailProvisionalNavigation navigation:WKNavigation!, withError error:Error) {
        if (error as NSError).code != NSURLErrorCancelled { window.subtitle = "Could not load project. Open Projects to check its server." }
    }
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView) {
        window.subtitle = "Workspace stopped responding. Reopen this project in your browser to recover saved work."
    }
}
