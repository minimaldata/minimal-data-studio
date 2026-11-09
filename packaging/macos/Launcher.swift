import Cocoa
import Sparkle
import CryptoKit

final class ProjectListClipView: NSClipView { override var isFlipped: Bool { true } }
final class ProjectListStack: NSStackView { override var isFlipped: Bool { true } }

final class StudioLauncher: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
    let managerID = UUID().uuidString
    var projectRows: NSStackView!
    var refreshTimer: Timer?
    var refreshing = false
    var managedTasks: [String: Process] = [:]
    var knownProjects: Set<String> = []
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
        if let address = liveProjects[path]?["url"] as? String, let url = URL(string:address) {
            defaults.set(path,forKey:"projectPath")
            currentProject = project; studioURL = url; NSWorkspace.shared.open(url); return
        }
        if startingProjects.contains(path) { return }
        defaults.set(path,forKey:"projectPath")
        start(project)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if offerInstallation() { return }
        updaterController = SPUStandardUpdaterController(startingUpdater:true, updaterDelegate:self, userDriverDelegate:nil)
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu()
        let updateItem = appMenu.addItem(withTitle:"Check for Updates…", action:#selector(checkForUpdates), keyEquivalent:"")
        updateItem.target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Minimal Data Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        menu.addItem(item)
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:720,height:520), styleMask:[.titled,.closable,.miniaturizable,.resizable], backing:.buffered, defer:false)
        window.title = "Minimal Data Studio"
        window.minSize = NSSize(width:720,height:550)
        window.isReleasedWhenClosed = false
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
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
        stack.addArrangedSubview(status)
        folder = NSTextField(wrappingLabelWithString:"")
        folder.font = .monospacedSystemFont(ofSize:11,weight:.regular)
        folder.textColor = .secondaryLabelColor
        folder.isHidden = true
        stack.addArrangedSubview(folder)
        let buttons = NSStackView()
        buttons.spacing = 10
        openButton = NSButton(title:"Open in browser", target:self, action:#selector(openBrowser))
        openButton.isEnabled = false
        chooseButton = NSButton(title:"Open project…", target:self, action:#selector(chooseProject))
        openButton.isHidden = true
        buttons.addArrangedSubview(openButton)
        buttons.addArrangedSubview(chooseButton)
        stack.addArrangedSubview(buttons)
        let label = NSTextField(labelWithString:"Open projects")
        label.font = .boldSystemFont(ofSize:15); stack.addArrangedSubview(label)
        let scroll = NSScrollView(); scroll.contentView = ProjectListClipView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        projectRows = ProjectListStack(); projectRows.orientation = .vertical; projectRows.alignment = .leading; projectRows.spacing = 12
        projectRows.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = projectRows
        stack.addArrangedSubview(scroll)
        NSLayoutConstraint.activate([scroll.heightAnchor.constraint(equalToConstant:280), scroll.widthAnchor.constraint(equalTo:stack.widthAnchor), projectRows.widthAnchor.constraint(equalTo:scroll.widthAnchor)])
        let note = NSTextField(wrappingLabelWithString:"Open returns to a workspace. Stop closes its server, not its files. Quit stops projects started by this copy of Studio. Save unsaved code before stopping.")
        note.font = .systemFont(ofSize:12)
        note.textColor = .secondaryLabelColor
        stack.addArrangedSubview(note)
        refreshTimer = Timer.scheduledTimer(withTimeInterval:3,repeats:true) { [weak self] _ in self?.refreshProjects() }
        refreshProjects()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        if let project = pendingProject {
            pendingProject = nil
            openProject(project)
        } else if let path = defaults.string(forKey:"projectPath"), FileManager.default.fileExists(atPath:path) {
            start(URL(fileURLWithPath:path,isDirectory:true))
        } else {
            chooseProject()
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
                    if valid { live[path] = entry }
                }
            }
            DispatchQueue.main.async {
                self.refreshing = false; self.liveProjects = live
                self.knownProjects.formUnion(live.keys); self.renderProjects()
            }
        }
    }

    func renderProjects() {
        for view in projectRows.arrangedSubviews { projectRows.removeArrangedSubview(view); view.removeFromSuperview() }
        status.stringValue = "One workspace per project folder. Your files stay in that folder."
        for path in knownProjects.sorted() {
            let running = liveProjects[path] != nil
            let row = NSStackView(); row.spacing = 12
            let labels = NSStackView(); labels.orientation = .vertical; labels.alignment = .leading; labels.spacing = 4
            let name = NSTextField(labelWithString:URL(fileURLWithPath:path).lastPathComponent + " · " + (startingProjects.contains(path) ? "Starting…" : running ? "Running" : "Stopped"))
            name.font = .boldSystemFont(ofSize:13)
            let location = NSTextField(wrappingLabelWithString:path); location.textColor = .secondaryLabelColor; location.font = .systemFont(ofSize:11)
            labels.addArrangedSubview(name); labels.addArrangedSubview(location); row.addArrangedSubview(labels)
            location.lineBreakMode = .byTruncatingMiddle; location.maximumNumberOfLines = 1
            location.toolTip = path
            let open = NSButton(title:running ? "Open" : "Start", target:self, action:#selector(openListedProject(_:)))
            open.identifier = NSUserInterfaceItemIdentifier(path); open.isEnabled = !startingProjects.contains(path)
            row.addArrangedSubview(open)
            let stop = NSButton(title:"Stop", target:self, action:#selector(stopListedProject(_:)))
            stop.identifier = NSUserInterfaceItemIdentifier(path); stop.isEnabled = running && liveProjects[path]?["token"] != nil
            row.addArrangedSubview(stop); projectRows.addArrangedSubview(row)
            labels.widthAnchor.constraint(equalTo:projectRows.widthAnchor,constant:-190).isActive = true
            row.widthAnchor.constraint(equalTo:projectRows.widthAnchor,constant:-16).isActive = true
        }
        if knownProjects.isEmpty { projectRows.addArrangedSubview(NSTextField(labelWithString:"No open projects. Choose a folder to begin.")) }
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
        knownProjects.insert(path); startingProjects.insert(path); renderProjects()
        let task = Process(); task.executableURL = resources.appendingPathComponent("python/bin/python3")
        task.arguments = [resources.appendingPathComponent("studio/serve.py").path,"--project-dir",path,"--port","0","--seed-project"]
        task.currentDirectoryURL = URL(fileURLWithPath:path)
        let support = registryURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at:support,withIntermediateDirectories:true)
        var env = ProcessInfo.processInfo.environment
        env["MDS_PROJECT_REGISTRY"] = registryURL.path; env["MDS_MANAGER_ID"] = managerID
        env["MDS_NATIVE_UPDATER"] = "1"; env["MDS_APP_VERSION"] = Bundle.main.object(forInfoDictionaryKey:"MDSVersion") as? String ?? "Preview"
        env["PYTHONNOUSERSITE"] = "1"; env["PYTHONDONTWRITEBYTECODE"] = "1"; env["PYTHONUNBUFFERED"] = "1"
        env["MDS_MANAGED_R_LIBRARY"] = support.appendingPathComponent("R-library").path; env["MPLCONFIGDIR"] = support.appendingPathComponent("matplotlib").path
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env.removeValue(forKey:"PYTHONHOME"); env.removeValue(forKey:"PYTHONPATH"); task.environment = env
        let out = Pipe(), err = Pipe(); task.standardOutput = out; task.standardError = err
        var output = "", errors = "", opened = false
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data:data,encoding:.utf8) else { return }
            DispatchQueue.main.async {
                guard let self = self else { return }; output += text
                let lines = output.components(separatedBy:"\n")
                for line in lines.dropLast() {
                    if !opened, line.hasPrefix("Minimal Data Studio: "), let url = URL(string:String(line.dropFirst("Minimal Data Studio: ".count))) {
                        opened = true; self.startingProjects.remove(path); self.currentProject = project; self.studioURL = url
                        NSWorkspace.shared.open(url); self.refreshProjects()
                    }
                }
                output = String((lines.last ?? "").suffix(8000))
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
            alert.informativeText = "Save unsaved code and finish running queries first. Projects started by this copy of Studio will stop. Your saved files and tables stay in place."
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
