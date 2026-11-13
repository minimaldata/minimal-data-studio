import Cocoa
import Sparkle
import CryptoKit

final class ProjectListClipView: NSClipView { override var isFlipped: Bool { true } }
final class ProjectListStack: NSStackView { override var isFlipped: Bool { true } }

// Cursor rectangles follow clipping, layout changes, and enabled state.
final class StudioButton: NSButton {
    override var isEnabled: Bool {
        didSet { window?.invalidateCursorRects(for:self) }
    }
    override func resetCursorRects() {
        super.resetCursorRects()
        if isEnabled { addCursorRect(visibleRect,cursor:.pointingHand) }
    }
}

final class StudioPopUpButton: NSPopUpButton {
    override var isEnabled: Bool {
        didSet { window?.invalidateCursorRects(for:self) }
    }
    override func resetCursorRects() {
        super.resetCursorRects()
        if isEnabled { addCursorRect(visibleRect,cursor:.pointingHand) }
    }
}

final class StudioLauncher: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
    let taskCredentials = TaskCredentials()
    lazy var credentialsController = CredentialsController()
    @objc func manageCredentials() { credentialsController.open(projectPaths:Array(knownProjects.union(liveProjects.keys)), current:currentProject?.path) }
    let managerID = UUID().uuidString
    var projectRows: NSStackView!
    var managerStack: NSStackView!
    var projectListHeight: NSLayoutConstraint!
    var fittedWindowHeight: CGFloat?
    var refreshTimer: Timer?
    var refreshing = false
    var runtimeSection: NSStackView!
    var runtimeSummary: NSButton!
    var runtimeStatus: NSTextField!
    var runtimeCheck: NSButton!
    var runtimeAdvanced: NSStackView!
    var runtimeProject: NSTextField!
    var runtimeSelectors: [String:NSPopUpButton] = [:]
    var runtimeTarget: (path:String,address:String)?
    var runtimeCheckGeneration = 0
    var runtimeDetails = "Run Check all to test SQL and table transfers through Python and R."
    var managedTasks: [String: Process] = [:]
    var knownProjects: Set<String> = []
    var projectMetadata: [String: [String: Int]] = [:]
    var liveProjects: [String: [String: Any]] = [:]
    var startingProjects: Set<String> = []
    var updaterController: SPUStandardUpdaterController!
    var pendingInstall: (() -> Void)?
    var updateRequested = false
    var window: NSWindow!
    var status: NSTextField!
    var folder: NSTextField!
    var openButton: NSButton!
    var chooseButton: NSButton!
    var process: Process?
    var studioURL: URL?
    var buffer = ""
    var errorBuffer = ""
    var startupTimer: Timer?
    var stopping = false
    var outPipe: Pipe?
    var errPipe: Pipe?
    var pendingProject: URL?
    var currentProject: URL?
    let defaults = UserDefaults.standard
    var localDevelopment:Bool { Bundle.main.object(forInfoDictionaryKey:"MDSLocalDevelopment") as? Bool == true }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        let file = URL(fileURLWithPath:filename).standardizedFileURL
        guard file.pathExtension.lowercased() == "mdsproject",
              let size = try? file.resourceValues(forKeys:[.fileSizeKey]).fileSize, size <= 4096,
              let data = try? Data(contentsOf:file),
              let marker = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
              marker["format"] as? String == "minimal-data-studio-project",
              marker["version"] as? Int == 1 else { return false }
        let project = file.deletingLastPathComponent().resolvingSymlinksInPath()
        if window == nil { pendingProject = project }
        else { openProject(project) }
        return true
    }

    func canonicalProject(_ project: URL) -> URL {
        guard let path = realpath(project.path, nil) else { return project.resolvingSymlinksInPath() }
        defer { free(path) }
        return URL(fileURLWithPath:String(cString:path),isDirectory:true)
    }

    func openProject(_ project: URL) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        let path = canonicalProject(project).path
        rememberProject(path)
        if let address = liveProjects[path]?["url"] as? String, let url = URL(string:address) {
            defaults.set(path,forKey:"projectPath")
            currentProject = project; studioURL = url; NSWorkspace.shared.open(url); checkRuntimes(path:path,address:url.absoluteString); return
        }
        if startingProjects.contains(path) { return }
        defaults.set(path,forKey:"projectPath")
        start(project)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        taskCredentials.manage = { [weak self] project in
            guard let self = self else { return }
            NSApp.activate(ignoringOtherApps:true)
            self.credentialsController.open(projectPaths:Array(self.knownProjects.union(self.liveProjects.keys).union([project])), current:project)
        }
        NSApp.setActivationPolicy(.regular)
        if let iconURL = Bundle.main.url(forResource:"Studio",withExtension:"icns"), let icon = NSImage(contentsOf:iconURL) {
            NSApp.applicationIconImage = icon
        }
        if !localDevelopment && offerInstallation() { return }
        updaterController = SPUStandardUpdaterController(startingUpdater:!localDevelopment, updaterDelegate:self, userDriverDelegate:nil)
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu()
        let updateItem = appMenu.addItem(withTitle:"Check for Updates…", action:#selector(checkForUpdates), keyEquivalent:"")
        updateItem.target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Minimal Data Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        menu.addItem(item)
        // Standard responder-chain actions also work in modal secure text fields.
        let editItem = NSMenuItem(title:"Edit", action:nil, keyEquivalent:"")
        let editMenu = NSMenu(title:"Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"),
                                      ("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                      ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle:title, action:NSSelectorFromString(action), keyEquivalent:key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:760,height:560), styleMask:[.titled,.closable,.miniaturizable,.resizable], backing:.buffered, defer:false)
        window.title = "Minimal Data Studio"
        window.minSize = NSSize(width:760,height:560)
        window.isReleasedWhenClosed = false
        let stack = NSStackView()
        managerStack = stack
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo:window.contentView!.leadingAnchor,constant:24),
            stack.trailingAnchor.constraint(equalTo:window.contentView!.trailingAnchor,constant:-24),
            stack.topAnchor.constraint(equalTo:window.contentView!.topAnchor,constant:24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo:window.contentView!.bottomAnchor,constant:-24)
        ])
        let heading = NSTextField(labelWithString:"Minimal Data Studio")
        heading.font = .boldSystemFont(ofSize:22)
        stack.addArrangedSubview(heading)
        status = NSTextField(wrappingLabelWithString:"Choose a folder for your files, database, and saved work.")
        status.isHidden = true
        stack.addArrangedSubview(status)
        folder = NSTextField(wrappingLabelWithString:"")
        folder.font = .monospacedSystemFont(ofSize:11,weight:.regular)
        folder.textColor = .secondaryLabelColor
        folder.isHidden = true
        stack.addArrangedSubview(folder)
        let buttons = NSStackView()
        buttons.spacing = 10
        openButton = StudioButton(title:"Open in browser", target:self, action:#selector(openBrowser))
        openButton.isEnabled = false
        chooseButton = StudioButton(title:"Open project…", target:self, action:#selector(chooseProject))
        openButton.isHidden = true
        buttons.addArrangedSubview(openButton)
        buttons.addArrangedSubview(StudioButton(title:"New project…", target:self, action:#selector(newProject)))
        buttons.addArrangedSubview(chooseButton)
        buttons.addArrangedSubview(StudioButton(title:"Credentials…", target:self, action:#selector(manageCredentials)))
        stack.addArrangedSubview(buttons)
        let scroll = NSScrollView(); scroll.contentView = ProjectListClipView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        projectRows = ProjectListStack(); projectRows.orientation = .vertical; projectRows.alignment = .leading; projectRows.spacing = 12
        projectRows.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = projectRows
        stack.addArrangedSubview(scroll)
        projectListHeight = scroll.heightAnchor.constraint(equalToConstant:80)
        NSLayoutConstraint.activate([projectListHeight, scroll.widthAnchor.constraint(equalTo:stack.widthAnchor), projectRows.widthAnchor.constraint(equalTo:scroll.widthAnchor)])
        let divider = NSBox(); divider.boxType = .separator
        stack.addArrangedSubview(divider)
        divider.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
        runtimeSummary = StudioButton(title:"Not checked",target:self,action:#selector(toggleRuntimeSection))
        runtimeSummary.isBordered = false; runtimeSummary.font = .systemFont(ofSize:13,weight:.semibold)
        runtimeSummary.contentTintColor = .secondaryLabelColor
        runtimeSummary.image = NSImage(systemSymbolName:"chevron.right",accessibilityDescription:nil)
        runtimeSummary.imagePosition = .imageLeading
        stack.addArrangedSubview(runtimeSummary)
        runtimeSection = NSStackView(); runtimeSection.orientation = .vertical
        runtimeSection.alignment = .leading; runtimeSection.spacing = 12
        runtimeSection.isHidden = true; stack.addArrangedSubview(runtimeSection)
        runtimeSection.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
        let runtimeHeader = NSStackView(); runtimeHeader.spacing = 12
        let runtimeHeading = NSTextField(labelWithString:"Runtimes")
        runtimeHeading.font = .boldSystemFont(ofSize:13)
        runtimeHeader.addArrangedSubview(runtimeHeading)
        let spacer = NSView(); runtimeHeader.addArrangedSubview(spacer)
        runtimeCheck = StudioButton(title:"Check all",target:self,action:#selector(checkAllRuntimes))
        runtimeCheck.bezelStyle = .rounded
        runtimeHeader.addArrangedSubview(runtimeCheck)
        let details = StudioButton(title:"Details…",target:self,action:#selector(showRuntimeDetails))
        details.toolTip = "Versions, check results, and troubleshooting"
        runtimeHeader.addArrangedSubview(details)
        runtimeSection.addArrangedSubview(runtimeHeader)
        runtimeHeader.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
        runtimeStatus = NSTextField(labelWithString:"SQL  —     Python  —     R  —")
        runtimeStatus.font = .monospacedSystemFont(ofSize:13,weight:.medium)
        runtimeStatus.textColor = .secondaryLabelColor
        runtimeStatus.toolTip = "Checks run when a project opens. Check all runs them again."
        runtimeSection.addArrangedSubview(runtimeStatus)
        let advanced = StudioButton(title:"Advanced settings",target:self,action:#selector(toggleRuntimeAdvanced(_:)))
        advanced.isBordered = false
        advanced.font = .systemFont(ofSize:12)
        advanced.contentTintColor = .secondaryLabelColor
        advanced.image = NSImage(systemSymbolName:"chevron.right",accessibilityDescription:nil)
        advanced.imagePosition = .imageLeading
        advanced.imageScaling = .scaleProportionallyDown
        advanced.setAccessibilityLabel("Advanced settings, collapsed")
        runtimeSection.addArrangedSubview(advanced)
        runtimeAdvanced = NSStackView(); runtimeAdvanced.orientation = .vertical
        runtimeAdvanced.alignment = .leading; runtimeAdvanced.spacing = 12
        runtimeAdvanced.isHidden = true; runtimeSection.addArrangedSubview(runtimeAdvanced)
        runtimeProject = NSTextField(labelWithString:"Open a project to choose its runtimes.")
        runtimeProject.font = .systemFont(ofSize:11); runtimeProject.textColor = .secondaryLabelColor
        runtimeAdvanced.addArrangedSubview(runtimeProject)
        for (language, title) in [("python","Python"),("r","R")] {
            let row = NSStackView(); row.spacing = 12
            let label = NSTextField(labelWithString:title); label.font = .systemFont(ofSize:12,weight:.medium)
            label.widthAnchor.constraint(equalToConstant:52).isActive = true
            row.addArrangedSubview(label)
            let selector = StudioPopUpButton(frame:.zero,pullsDown:false)
            selector.identifier = NSUserInterfaceItemIdentifier(language)
            selector.target = self; selector.action = #selector(selectRuntime(_:))
            selector.addItem(withTitle:"Open a project first"); selector.isEnabled = false
            selector.widthAnchor.constraint(equalToConstant:510).isActive = true
            row.addArrangedSubview(selector); runtimeSelectors[language] = selector
            runtimeAdvanced.addArrangedSubview(row)
        }
        let footer = NSStackView(); footer.spacing = 12
        let version = NSTextField(labelWithString:Bundle.main.object(forInfoDictionaryKey:"MDSVersion") as? String ?? "Preview")
        version.font = .systemFont(ofSize:11); version.textColor = .tertiaryLabelColor
        footer.addArrangedSubview(version); footer.addArrangedSubview(NSView())
        let update = StudioButton(title:"Check for updates…",target:self,action:#selector(checkForUpdates))
        update.bezelStyle = .inline; update.font = .systemFont(ofSize:11)
        update.toolTip = "Update Studio and its bundled runtimes"
        footer.addArrangedSubview(update); stack.addArrangedSubview(footer)
        footer.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
        refreshTimer = Timer.scheduledTimer(withTimeInterval:3,repeats:true) { [weak self] _ in self?.refreshProjects() }
        knownProjects.formUnion(defaults.stringArray(forKey:"recentProjects") ?? [])
        projectMetadata = defaults.dictionary(forKey:"projectMetadata") as? [String:[String:Int]] ?? [:]
        refreshProjects()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        if let project = pendingProject {
            pendingProject = nil
            openProject(project)
        } else if let path = defaults.string(forKey:"projectPath"), FileManager.default.fileExists(atPath:path) {
            start(URL(fileURLWithPath:path,isDirectory:true))
        }
        if updateRequested { checkForUpdates() }
    }


    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.scheme == "mds-studio" && $0.host == "check-for-updates" }) else { return }
        if updaterController == nil { updateRequested = true }
        else { checkForUpdates() }
    }

    @objc func checkForUpdates() {
        NSApp.activate(ignoringOtherApps:true)
        if pendingInstall != nil { confirmUpdateRestart(); return }
        updaterController.checkForUpdates(nil)
    }

    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem,
                 untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        pendingInstall = installHandler
        DispatchQueue.main.async { self.confirmUpdateRestart() }
        return true
    }

    func confirmUpdateRestart() {
        let alert = NSAlert()
        alert.messageText = "Ready to install and restart Minimal Data Studio?"
        alert.informativeText = "Save any unsaved code in your browser and wait for running queries to finish first. Minimal Data Studio will close the projects started by this app and reopen your most recent project. Your project files stay in place."
        alert.addButton(withTitle:"Install and restart")
        alert.addButton(withTitle:"Return to my work")
        NSApp.activate(ignoringOtherApps:true)
        if alert.runModal() == .alertFirstButtonReturn, let install = pendingInstall {
            pendingInstall = nil
            stop()
            install()
        }
    }

    func offerInstallation() -> Bool {
        let source = Bundle.main.bundleURL.resolvingSymlinksInPath()
        let applications = URL(fileURLWithPath:"/Applications", isDirectory:true)
        let userApplications = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")
        if source.deletingLastPathComponent() == applications || source.deletingLastPathComponent() == userApplications { return false }
        let destination = applications.appendingPathComponent("Minimal Data Studio.app")
        let fm = FileManager.default
        let exists = fm.fileExists(atPath:destination.path)
        let alert = NSAlert()
        alert.messageText = "Install Minimal Data Studio in Applications?"
        alert.informativeText = "Keep one installed copy so updates replace it in place. Your projects stay in their own folders." + (exists ? " An existing copy in Applications will be moved to Trash and replaced." : "")
        alert.addButton(withTitle:exists ? "Replace and open" : "Install and open")
        alert.addButton(withTitle:"Not now")
        if alert.runModal() != .alertFirstButtonReturn { return false }
        if NSWorkspace.shared.runningApplications.contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && $0.bundleURL?.standardizedFileURL == destination }) {
            let warning = NSAlert(); warning.messageText = "Quit the installed copy of Minimal Data Studio first."
            warning.informativeText = "Then reopen this download to install the new version."; warning.runModal(); NSApp.terminate(nil)
            return true
        }
        let staged = applications.appendingPathComponent(".Minimal Data Studio-" + UUID().uuidString + ".app")
        do {
            try fm.copyItem(at:source, to:staged)
            if exists { try fm.trashItem(at:destination, resultingItemURL:nil) }
            try fm.moveItem(at:staged, to:destination)
            let configuration = NSWorkspace.OpenConfiguration()
            if let project = pendingProject { defaults.set(project.path, forKey:"projectPath") }
            NSWorkspace.shared.openApplication(at:destination, configuration:configuration) { _, error in
                DispatchQueue.main.async {
                    if let error = error {
                        let warning = NSAlert(); warning.messageText = "Minimal Data Studio was installed. Open it from Applications."
                        warning.informativeText = error.localizedDescription; warning.runModal()
                    }
                    NSApp.terminate(nil)
                }
            }
            return true
        } catch {
            try? fm.removeItem(at:staged)
            let warning = NSAlert(); warning.messageText = "Could not install Minimal Data Studio"
            warning.informativeText = error.localizedDescription + " You can drag Minimal Data Studio into Applications in Finder instead."
            warning.runModal(); return false
        }
    }

    func rememberProject(_ path: String) {
        var recent = defaults.stringArray(forKey:"recentProjects") ?? []
        recent.removeAll { $0 == path }; recent.insert(path,at:0)
        defaults.set(Array(recent.prefix(30)),forKey:"recentProjects")
        knownProjects.insert(path)
    }

    @objc func newProject() {
        let picker = NSSavePanel()
        picker.title = "Create a new project"; picker.prompt = "Create project"
        picker.nameFieldStringValue = "Untitled project"; picker.canCreateDirectories = true
        let options = NSStackView(); options.orientation = .vertical; options.alignment = .leading
        let data = StudioButton(checkboxWithTitle:"Include sample data",target:nil,action:nil)
        let notebooks = StudioButton(checkboxWithTitle:"Include sample notebooks",target:nil,action:nil)
        data.state = .on; notebooks.state = .on
        options.addArrangedSubview(data); options.addArrangedSubview(notebooks); picker.accessoryView = options
        guard picker.runModal() == .OK, let destination = picker.url else { return }
        if FileManager.default.fileExists(atPath:destination.path) {
            showError("That folder already exists. Use Open project to open it, or choose a new folder name."); return
        }
        do {
            try FileManager.default.createDirectory(at:destination,withIntermediateDirectories:false)
            let studio = destination.appendingPathComponent(".studio")
            try FileManager.default.createDirectory(at:studio,withIntermediateDirectories:false)
            let settings = ["sampleData":data.state == .on || notebooks.state == .on,"sampleNotebooks":notebooks.state == .on]
            try JSONSerialization.data(withJSONObject:settings).write(to:studio.appendingPathComponent("creation-options.json"),options:.atomic)
            openProject(destination)
        } catch { showError("Could not create project: " + error.localizedDescription) }
    }

    @objc func showProjectInFinder(_ sender:NSButton) {
        guard let path = sender.identifier?.rawValue else { return }
        guard FileManager.default.fileExists(atPath:path) else { showError("Project folder not found: " + path); return }
        NSWorkspace.shared.open(URL(fileURLWithPath:path,isDirectory:true))
    }

    @objc func showRuntimeDetails() {
        let alert = NSAlert(); alert.messageText = "Runtime checks"
        alert.informativeText = runtimeDetails + "\n\nIf a check fails: first save your code, stop and restart the project, then check again. For missing packages or a personal installation, open the workspace’s Help → Runtime setup. For Studio-managed runtimes, use Update Studio. A transfer failure can be a Studio server issue even when the runtime is installed."
        alert.addButton(withTitle:"Close"); alert.runModal()
    }

    @objc func checkAllRuntimes() {
        let preferred = currentProject.map { canonicalProject($0).path }
        guard let path = preferred.flatMap({ liveProjects[$0] != nil ? $0 : nil }) ?? liveProjects.keys.sorted().first,
              let address = liveProjects[path]?["url"] as? String else {
            runtimeStatus.stringValue = "Start a project to check runtimes."; return
        }
        checkRuntimes(path:path,address:address)
    }

    func fitManagerWindow() {
        guard managerStack != nil, runtimeAdvanced != nil else { return }
        window.contentView?.layoutSubtreeIfNeeded()
        projectListHeight.constant = min(280, max(45, projectRows.fittingSize.height))
        window.contentView?.layoutSubtreeIfNeeded()
        let contentHeight = managerStack.fittingSize.height + 48
        let desired = window.frameRect(forContentRect:NSRect(x:0,y:0,width:760,height:contentHeight)).height
        window.minSize = NSSize(width:760,height:desired)
        if fittedWindowHeight == nil || abs(desired - fittedWindowHeight!) > 1 {
            var frame = window.frame
            frame.origin.y += frame.height - desired; frame.size.height = desired
            window.setFrame(frame,display:true)
            fittedWindowHeight = desired
        }
    }

    func resizeRuntimeSection(from oldHeight:CGFloat) { fitManagerWindow() }

    @objc func toggleRuntimeSection() {
        let oldHeight = window.minSize.height
        runtimeSection.isHidden.toggle()
        runtimeSummary.image = NSImage(systemSymbolName:runtimeSection.isHidden ? "chevron.right" : "chevron.down",accessibilityDescription:nil)
        resizeRuntimeSection(from:oldHeight)
    }

    @objc func toggleRuntimeAdvanced(_ sender:NSButton) {
        let oldHeight = window.minSize.height
        let expanded = runtimeAdvanced.isHidden
        sender.image = NSImage(systemSymbolName:expanded ? "chevron.down" : "chevron.right",accessibilityDescription:nil)
        sender.setAccessibilityLabel("Advanced settings, " + (expanded ? "expanded" : "collapsed"))
        runtimeAdvanced.isHidden = !expanded
        resizeRuntimeSection(from:oldHeight)
    }

    func populateRuntimeSelector(_ language:String, setup:[String:Any]) {
        guard let selector = runtimeSelectors[language] else { return }
        selector.removeAllItems()
        selector.addItem(withTitle:"Studio-managed — Recommended for Beginners")
        selector.lastItem?.representedObject = ["language":language,"mode":"managed"]
        var paths = setup["candidates"] as? [String] ?? []
        let selectedPath = setup["path"] as? String ?? ""
        if setup["mode"] as? String == "custom", !selectedPath.isEmpty, !paths.contains(selectedPath) { paths.append(selectedPath) }
        for path in paths {
            selector.addItem(withTitle:path)
            selector.lastItem?.representedObject = ["language":language,"mode":"custom","path":path]
            selector.lastItem?.toolTip = path
            if setup["mode"] as? String == "custom", path == selectedPath { selector.select(selector.lastItem) }
        }
        selector.menu?.addItem(NSMenuItem.separator())
        selector.addItem(withTitle:"Choose installation…")
        selector.lastItem?.representedObject = ["language":language,"mode":"browse"]
        selector.isEnabled = !setup.isEmpty
        selector.toolTip = (setup["version"] as? String ?? "Not ready") + " · " + selectedPath
    }

    @objc func selectRuntime(_ sender:NSPopUpButton) {
        guard let target = runtimeTarget, var choice = sender.selectedItem?.representedObject as? [String:String] else { return }
        if choice["mode"] == "browse" {
            let picker = NSOpenPanel(); picker.title = "Choose " + (choice["language"] == "r" ? "Rscript" : "Python") + " executable"
            picker.canChooseDirectories = false; picker.canChooseFiles = true; picker.allowsMultipleSelection = false
            picker.message = "Choose the executable for this project."
            guard picker.runModal() == .OK, let url = picker.url else {
                checkRuntimes(path:target.path,address:target.address); return
            }
            choice["mode"] = "custom"; choice["path"] = url.path
        }
        checkRuntimes(path:target.path,address:target.address,selection:choice)
    }

    func checkRuntimes(path:String,address:String,selection:[String:String]? = nil) {
        guard let resources = Bundle.main.resourceURL else { return }
        runtimeSummary.title = "Checking systems…"
        runtimeSummary.contentTintColor = .secondaryLabelColor
        runtimeSummary.toolTip = path
        runtimeTarget = (path,address)
        runtimeProject.stringValue = "For " + URL(fileURLWithPath:path).lastPathComponent + " · SQL uses bundled DuckDB"
        runtimeProject.toolTip = path
        for selector in runtimeSelectors.values { selector.isEnabled = false }
        runtimeCheckGeneration += 1
        let generation = runtimeCheckGeneration
        runtimeCheck.isEnabled = false
        runtimeStatus.stringValue = "SQL  …     Python  …     R  …"
        runtimeStatus.textColor = .secondaryLabelColor
        runtimeStatus.toolTip = "Checking " + path
        DispatchQueue.global().async {
            let task = Process(); task.executableURL = resources.appendingPathComponent("python/bin/python3")
            task.arguments = [resources.appendingPathComponent("studio/runtime_probe.py").path,address]
            if let selection = selection, let data = try? JSONSerialization.data(withJSONObject:selection), let json = String(data:data,encoding:.utf8) { task.arguments?.append(json) }
            let output = Pipe(); task.standardOutput = output
            let errors = Pipe(); task.standardError = errors
            var checks: [[String:Any]] = ["SQL","Python","R"].map { ["name":$0,"ok":false] }
            var detail = ""
            do {
                try task.run()
                let data = output.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
                if let results = try JSONSerialization.jsonObject(with:data) as? [[String:Any]] {
                    checks = results
                    detail = results.map { ($0["name"] as? String ?? "Runtime") + ": " + ($0["detail"] as? String ?? "") }.joined(separator:"\n\n")
                }
            } catch { detail = error.localizedDescription }
            DispatchQueue.main.async {
                guard self.runtimeCheckGeneration == generation else { return }
                self.runtimeCheck.isEnabled = true
                let allOK = checks.count == 3 && checks.allSatisfy { $0["ok"] as? Bool == true }
                self.runtimeSummary.title = allOK ? "All Systems Operational" : "Error"
                self.runtimeSummary.contentTintColor = allOK ? .systemGreen : .systemRed
                for result in checks {
                    let language = (result["name"] as? String ?? "").lowercased()
                    if language == "python" || language == "r" { self.populateRuntimeSelector(language,setup:result["setup"] as? [String:Any] ?? [:]) }
                }
                if let error = checks.first?["selectionError"] as? String {
                    let alert = NSAlert(); alert.messageText = "Could not change runtime"
                    alert.informativeText = error; alert.addButton(withTitle:"OK"); alert.runModal()
                }
                let display = NSMutableAttributedString(string:"")
                for (index, result) in checks.enumerated() {
                    if index > 0 { display.append(NSAttributedString(string:"     ")) }
                    let ok = result["ok"] as? Bool == true
                    let label = (result["name"] as? String ?? "Runtime") + (ok ? "  ✓" : "  ✕")
                    display.append(NSAttributedString(string:label,attributes:[.foregroundColor:ok ? NSColor.systemGreen : NSColor.systemRed,.font:NSFont.monospacedSystemFont(ofSize:13,weight:.semibold)]))
                }
                self.runtimeStatus.attributedStringValue = display
                self.runtimeStatus.toolTip = path + " · checked " + DateFormatter.localizedString(from:Date(),dateStyle:.none,timeStyle:.short)
                self.runtimeDetails = "Project: " + path + "\nChecked: " + DateFormatter.localizedString(from:Date(),dateStyle:.short,timeStyle:.short) + "\n\n" + detail
            }
        }
    }

    @objc func chooseProject() {
        let picker = NSOpenPanel()
        picker.title = "Choose a Minimal Data Studio project folder"
        picker.message = "Choose an existing project or create a new folder. Your files and database will be saved here."
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.canCreateDirectories = true
        picker.prompt = "Open project"
        if picker.runModal() == .OK, let url = picker.url {
            openProject(url.resolvingSymlinksInPath())
        }
    }

    var registryURL: URL {
        if let override = ProcessInfo.processInfo.environment["MDS_PROJECT_REGISTRY"] { return URL(fileURLWithPath:override) }
        return FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Minimal Data Studio/projects.json")
    }

    func refreshProjects() {
        guard !refreshing else { return }; refreshing = true
        let registry = registryURL
        DispatchQueue.global().async {
            var live: [String:[String:Any]] = [:]
            var metadata: [String:[String:Int]] = [:]
            if let data = try? Data(contentsOf:registry), let entries = try? JSONSerialization.jsonObject(with:data) as? [String:[String:Any]] {
                for (path, entry) in entries {
                    guard let address = entry["url"] as? String, let url = URL(string:address), url.scheme == "http", ["localhost","127.0.0.1"].contains(url.host ?? ""), url.port != nil else { continue }
                    let expected = SHA256.hash(data:Data(path.utf8)).map { String(format:"%02x",$0) }.joined()
                    var request = URLRequest(url:url.appendingPathComponent("project-health")); request.timeoutInterval = 1
                    let wait = DispatchSemaphore(value:0)
                    var valid = false
                    URLSession.shared.dataTask(with:request) { data, _, _ in
                        if let data = data, let info = try? JSONSerialization.jsonObject(with:data) as? [String:String] {
                            valid = info["app"] == "minimal-data-studio" && info["project"] == expected
                        }
                        wait.signal()
                    }.resume()
                    wait.wait()
                    if valid {
                        live[path] = entry
                        var request = URLRequest(url:url.appendingPathComponent("project-metadata")); request.timeoutInterval = 1
                        let done = DispatchSemaphore(value:0)
                        URLSession.shared.dataTask(with:request) { data, _, _ in
                            if let data = data, let info = try? JSONSerialization.jsonObject(with:data) as? [String:Int], info["tables"] != nil { metadata[path] = info }
                            done.signal()
                        }.resume(); done.wait()
                    }
                }
            }
            DispatchQueue.main.async {
                self.refreshing = false; self.liveProjects = live
                self.knownProjects.formUnion(live.keys)
                self.projectMetadata.merge(metadata) { _, new in new }
                self.defaults.set(self.projectMetadata,forKey:"projectMetadata")
                for path in live.keys where !(self.defaults.stringArray(forKey:"recentProjects") ?? []).contains(path) { self.rememberProject(path) }
                self.renderProjects()
            }
        }
    }

    func renderProjects() {
        for view in projectRows.arrangedSubviews { projectRows.removeArrangedSubview(view); view.removeFromSuperview() }
        status.stringValue = "One workspace per project folder. Your files stay in that folder."
        let recent = defaults.stringArray(forKey:"recentProjects") ?? []
        let ordered = knownProjects.sorted(by: { (recent.firstIndex(of:$0) ?? 999) < (recent.firstIndex(of:$1) ?? 999) })
        for active in [true, false] {
            let paths = ordered.filter { (liveProjects[$0] != nil || startingProjects.contains($0)) == active }
            if !active && paths.isEmpty { continue }
            let heading = NSTextField(labelWithString:active ? "Running projects" : "Recent projects")
            heading.font = .systemFont(ofSize:11,weight:.semibold)
            heading.textColor = .secondaryLabelColor
            projectRows.addArrangedSubview(heading)
            if paths.isEmpty {
                let empty = NSTextField(labelWithString:active ? "No projects running." : "No other recent projects.")
                empty.font = .systemFont(ofSize:12); empty.textColor = .secondaryLabelColor
                projectRows.addArrangedSubview(empty)
            }
            for path in paths {
            let running = liveProjects[path] != nil
            let row = NSStackView(); row.spacing = 8
            let labels = NSStackView(); labels.orientation = .vertical; labels.alignment = .leading; labels.spacing = 4
            let name = NSTextField(labelWithString:URL(fileURLWithPath:path).lastPathComponent + (startingProjects.contains(path) ? " · Starting…" : ""))
            name.font = .boldSystemFont(ofSize:13)
            let location = NSTextField(wrappingLabelWithString:path); location.textColor = .secondaryLabelColor; location.font = .systemFont(ofSize:11)
            row.addArrangedSubview(name); row.addArrangedSubview(NSView())
            name.lineBreakMode = .byTruncatingTail
            name.setContentCompressionResistancePriority(.defaultLow,for:.horizontal)
            labels.addArrangedSubview(row); labels.addArrangedSubview(location)
            location.lineBreakMode = .byTruncatingMiddle; location.maximumNumberOfLines = 1
            location.toolTip = path
            let db = URL(fileURLWithPath:path).appendingPathComponent(".studio/workspace.duckdb")
            let bytes = (try? FileManager.default.attributesOfItem(atPath:db.path)[.size] as? NSNumber)?.int64Value ?? 0
            var detail = "Database: " + ByteCountFormatter.string(fromByteCount:bytes,countStyle:.file)
            if let meta = projectMetadata[path], let tables = meta["tables"], let views = meta["views"] {
                detail += " · \(tables) " + (tables == 1 ? "table" : "tables") + " · \(views) " + (views == 1 ? "view" : "views") + (running ? "" : " (last opened)")
            }
            let info = NSTextField(labelWithString:detail); info.font = .systemFont(ofSize:11); info.textColor = .secondaryLabelColor
            let metadata = NSStackView(); metadata.spacing = 12
            metadata.addArrangedSubview(info)
            labels.addArrangedSubview(metadata)
            if running, let address = liveProjects[path]?["url"] as? String {
                let urlLink = StudioButton(title:address,target:self,action:#selector(openListedProject(_:)))
                urlLink.identifier = NSUserInterfaceItemIdentifier(path)
                urlLink.isBordered = false
                urlLink.font = .monospacedSystemFont(ofSize:11,weight:.regular)
                urlLink.contentTintColor = .linkColor
                urlLink.toolTip = "Open this project in your browser"
                urlLink.setAccessibilityLabel("Open project at " + address)
                metadata.addArrangedSubview(urlLink)
            }
            let finder = StudioButton(title:"Finder",target:self,action:#selector(showProjectInFinder(_:)))
            finder.identifier = NSUserInterfaceItemIdentifier(path); finder.toolTip = "Open project folder in Finder"
            finder.title = ""; finder.image = NSImage(systemSymbolName:"folder",accessibilityDescription:"Open in Finder")
            finder.isBordered = true; finder.bezelStyle = .rounded; finder.setAccessibilityLabel("Open in Finder")
            finder.widthAnchor.constraint(equalToConstant:38).isActive = true
            let open = StudioButton(title:running ? "Open" : "Start", target:self, action:#selector(openListedProject(_:)))
            open.identifier = NSUserInterfaceItemIdentifier(path); open.isEnabled = !startingProjects.contains(path)
            open.title = running ? "Open" : "Start"
            open.font = .systemFont(ofSize:13,weight:.semibold)
            open.contentTintColor = .controlAccentColor
            open.toolTip = running ? "Open in browser" : "Start project"
            open.setAccessibilityLabel(open.toolTip!)
            open.widthAnchor.constraint(equalToConstant:64).isActive = true
            row.addArrangedSubview(open); row.addArrangedSubview(finder)
            let stop = StudioButton(title:"Stop", target:self, action:#selector(stopListedProject(_:)))
            stop.identifier = NSUserInterfaceItemIdentifier(path); stop.isEnabled = running && liveProjects[path]?["token"] != nil
            stop.title = ""; stop.image = NSImage(systemSymbolName:"stop.fill",accessibilityDescription:"Stop project")
            stop.contentTintColor = .systemRed
            stop.toolTip = "Stop project"; stop.setAccessibilityLabel("Stop project")
            stop.widthAnchor.constraint(equalToConstant:38).isActive = true
            if active { row.addArrangedSubview(stop) }
            projectRows.addArrangedSubview(labels)
            labels.widthAnchor.constraint(equalTo:projectRows.widthAnchor,constant:-16).isActive = true
            row.widthAnchor.constraint(equalTo:labels.widthAnchor).isActive = true
            location.widthAnchor.constraint(equalTo:labels.widthAnchor).isActive = true
            let separator = NSBox(); separator.boxType = .separator
            projectRows.addArrangedSubview(separator)
            separator.widthAnchor.constraint(equalTo:labels.widthAnchor).isActive = true
        }
        }
        fitManagerWindow()
    }

    @objc func openListedProject(_ sender:NSButton) {
        if let path = sender.identifier?.rawValue { openProject(URL(fileURLWithPath:path)) }
    }
    @objc func stopListedProject(_ sender:NSButton) {
        guard let path = sender.identifier?.rawValue, let entry = liveProjects[path] else { return }
        let alert = NSAlert(); alert.messageText = "Stop " + URL(fileURLWithPath:path).lastPathComponent + "?"
        alert.informativeText = "Save unsaved code and wait for running queries to finish. Browser tabs for this project will disconnect. Your saved files and tables stay in place. Other projects keep running."
        alert.addButton(withTitle:"Stop project"); alert.addButton(withTitle:"Cancel")
        if alert.runModal() != .alertFirstButtonReturn { return }
        sender.isEnabled = false
        DispatchQueue.global().async {
            let ok = self.requestStop(entry)
            DispatchQueue.main.async {
                if !ok { self.showError("Could not stop this project. It may already have stopped. Refresh and try again.") }
                self.refreshProjects()
            }
        }
    }
    func requestStop(_ entry:[String:Any]) -> Bool {
        guard let address = entry["url"] as? String, let url = URL(string:address), url.scheme == "http", ["localhost","127.0.0.1"].contains(url.host ?? ""), let token = entry["token"] as? String else { return false }
        var request = URLRequest(url:url.appendingPathComponent("manager/stop")); request.httpMethod = "POST"; request.timeoutInterval = 15
        request.setValue(token,forHTTPHeaderField:"X-Studio-Token")
        let wait = DispatchSemaphore(value:0); var ok = false
        URLSession.shared.dataTask(with:request) { _, response, _ in ok = (response as? HTTPURLResponse)?.statusCode == 200; wait.signal() }.resume()
        wait.wait(); return ok
    }

    func start(_ project: URL) {
        guard let resources = Bundle.main.resourceURL else { return }
        let path = canonicalProject(project).path
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath:path,isDirectory:&directory), directory.boolValue else { showError("Project folder not found: " + path); return }
        rememberProject(path); startingProjects.insert(path); renderProjects()
        let task = Process(); task.executableURL = resources.appendingPathComponent("python/bin/python3")
        task.arguments = [resources.appendingPathComponent("studio/serve.py").path,"--project-dir",path,"--port","0","--seed-project"]
        task.currentDirectoryURL = URL(fileURLWithPath:path)
        let support = registryURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at:support,withIntermediateDirectories:true)
        var env = ProcessInfo.processInfo.environment
        env["MDS_PROJECT_REGISTRY"] = registryURL.path; env["MDS_MANAGER_ID"] = managerID
        env["MDS_TASK_BRIDGE"] = "1"
        env["MDS_NATIVE_UPDATER"] = localDevelopment ? "0" : "1"; env["MDS_APP_VERSION"] = Bundle.main.object(forInfoDictionaryKey:"MDSVersion") as? String ?? "Preview"
        env["PYTHONNOUSERSITE"] = "1"; env["PYTHONDONTWRITEBYTECODE"] = "1"; env["PYTHONUNBUFFERED"] = "1"
        env["MDS_MANAGED_R_LIBRARY"] = support.appendingPathComponent("R-library").path; env["MPLCONFIGDIR"] = support.appendingPathComponent("matplotlib").path
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env.removeValue(forKey:"PYTHONHOME"); env.removeValue(forKey:"PYTHONPATH"); task.environment = env
        let out = Pipe(), err = Pipe(), input = Pipe(); task.standardOutput = out; task.standardError = err; task.standardInput = input
        var output = "", errors = "", opened = false
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data:data,encoding:.utf8) else { return }
            DispatchQueue.main.async {
                guard let self = self else { return }; output += text
                let lines = output.components(separatedBy:"\n")
                for line in lines.dropLast() {
                    if line.hasPrefix("MDS_TASK_CREDENTIALS:") { self.taskCredentials.respond(line:line,project:path,input:input.fileHandleForWriting); continue }
                    if !opened, line.hasPrefix("Minimal Data Studio: "), let url = URL(string:String(line.dropFirst("Minimal Data Studio: ".count))) {
                        opened = true; self.startingProjects.remove(path); self.currentProject = project; self.studioURL = url
                        NSWorkspace.shared.open(url); self.refreshProjects(); self.checkRuntimes(path:path,address:url.absoluteString)
                    }
                }
                output = String((lines.last ?? "").suffix(50000))
            }
        }
        err.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if let text = String(data:data,encoding:.utf8) { DispatchQueue.main.async { errors = String((errors + text).suffix(8000)) } }
        }
        task.terminationHandler = { [weak self] proc in DispatchQueue.main.async {
            guard let self = self else { return }; self.managedTasks.removeValue(forKey:path); self.startingProjects.remove(path)
            out.fileHandleForReading.readabilityHandler = nil; err.fileHandleForReading.readabilityHandler = nil
            if proc.terminationStatus != 0 && !self.stopping { self.showError(errors.isEmpty ? "Could not open the project." : errors) }
            self.refreshProjects()
        } }
        do {
            managedTasks[path] = task; try task.run()
            Timer.scheduledTimer(withTimeInterval:45,repeats:false) { [weak self] _ in
                guard let self = self, self.startingProjects.contains(path), self.managedTasks[path] === task else { return }
                if task.isRunning { task.terminate() }
                self.startingProjects.remove(path); self.showError("Starting the project took too long. Try opening it again."); self.renderProjects()
            }
        }
        catch { managedTasks.removeValue(forKey:path); startingProjects.remove(path); showError(error.localizedDescription); renderProjects() }
    }

    @objc func openBrowser() {
        if let url = studioURL { NSWorkspace.shared.open(url) }
    }
    func showError(_ text:String) {
        let projectLocked = text.contains("Could not set lock on file") || text.contains("Conflicting lock is held")
        status.stringValue = projectLocked ? "This project is already open in another copy of Studio." : "Could not open Minimal Data Studio."
        let alert = NSAlert()
        if projectLocked {
            alert.messageText = "This project is already open"
            alert.informativeText = "First, quit the other copy of Minimal Data Studio, then choose this project again. Closing its browser tab does not stop the local server.\n\nIf you started Minimal Data Studio from a terminal, stop that server there. You can also choose a different project. Your project files have not been changed."
            alert.addButton(withTitle:"OK")
        } else {
            alert.messageText = "Minimal Data Studio could not start"
            alert.informativeText = text
        }
        alert.runModal()
    }
    func stop() {
        stopping = true; refreshTimer?.invalidate()
        if let data = try? Data(contentsOf:registryURL), let entries = try? JSONSerialization.jsonObject(with:data) as? [String:[String:Any]] {
            for entry in entries.values where entry["owner"] as? String == managerID { _ = requestStop(entry) }
        }
        for task in managedTasks.values where task.isRunning { task.terminate() }
    }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func applicationShouldTerminate(_ sender:NSApplication) -> NSApplication.TerminateReply {
        if stopping { return .terminateNow }
        if liveProjects.values.contains(where: { $0["owner"] as? String == managerID }) || !startingProjects.isEmpty {
            let alert = NSAlert(); alert.messageText = "Quit Minimal Data Studio?"
            alert.informativeText = "Save unsaved code and finish running queries first. Projects and Python tasks started by this copy of Studio will stop. Task files already written are not undone. Your saved files and tables stay in place."
            alert.addButton(withTitle:"Quit"); alert.addButton(withTitle:"Keep working")
            return alert.runModal() == .alertFirstButtonReturn ? .terminateNow : .terminateCancel
        }
        return .terminateNow
    }
    func applicationWillTerminate(_ notification:Notification) { stop() }
}
let application = NSApplication.shared
let delegate = StudioLauncher()
application.delegate = delegate
application.run()
