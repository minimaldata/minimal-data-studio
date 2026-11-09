import Cocoa
import Sparkle

final class StudioLauncher: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
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

    func openProject(_ project: URL) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        if currentProject == project && process?.isRunning == true {
            openBrowser()
            return
        }
        stop()
        defaults.set(project.path,forKey:"projectPath")
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
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:540,height:280), styleMask:[.titled,.closable,.miniaturizable], backing:.buffered, defer:false)
        window.title = "Minimal Data Studio"
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
            stack.topAnchor.constraint(equalTo:window.contentView!.topAnchor,constant:24)
        ])
        let heading = NSTextField(labelWithString:"Minimal Data Studio")
        heading.font = .boldSystemFont(ofSize:22)
        stack.addArrangedSubview(heading)
        status = NSTextField(wrappingLabelWithString:"Choose a folder for your files, database, and saved work.")
        stack.addArrangedSubview(status)
        folder = NSTextField(wrappingLabelWithString:"")
        folder.font = .monospacedSystemFont(ofSize:11,weight:.regular)
        folder.textColor = .secondaryLabelColor
        stack.addArrangedSubview(folder)
        let buttons = NSStackView()
        buttons.spacing = 10
        openButton = NSButton(title:"Open in browser", target:self, action:#selector(openBrowser))
        openButton.isEnabled = false
        chooseButton = NSButton(title:"Choose project…", target:self, action:#selector(chooseProject))
        buttons.addArrangedSubview(openButton)
        buttons.addArrangedSubview(chooseButton)
        stack.addArrangedSubview(buttons)
        let note = NSTextField(wrappingLabelWithString:"Keep this app running while you work. Quit stops the local server. Your project stays in its folder.")
        note.font = .systemFont(ofSize:12)
        note.textColor = .secondaryLabelColor
        stack.addArrangedSubview(note)
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
        alert.informativeText = "Save any unsaved code in your browser and wait for running queries to finish first. Minimal Data Studio will close its local server and reopen your current project. Your project files stay in place."
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

    func start(_ project: URL) {
        guard let resources = Bundle.main.resourceURL else { return }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath:project.path, isDirectory:&isDirectory), isDirectory.boolValue else {
            showError("Project folder not found: " + project.path + "\nIt may have been moved or renamed. Choose its current location with Choose project.")
            return
        }
        currentProject = project.resolvingSymlinksInPath()
        let python = resources.appendingPathComponent("python/bin/python3")
        let appRoot = resources.appendingPathComponent("studio")
        let support = FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Minimal Data Studio")
        do { try FileManager.default.createDirectory(at:support,withIntermediateDirectories:true) }
        catch { showError(error.localizedDescription); return }
        let task = Process()
        task.executableURL = python
        task.arguments = [appRoot.appendingPathComponent("serve.py").path,"--project-dir",project.path,"--port","0","--seed-project"]
        task.currentDirectoryURL = project
        var env = ProcessInfo.processInfo.environment
        env["MDS_NATIVE_UPDATER"] = "1"
        env["MDS_APP_VERSION"] = Bundle.main.object(forInfoDictionaryKey:"MDSVersion") as? String ?? ""
        env["PYTHONNOUSERSITE"] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        env["MDS_MANAGED_R_LIBRARY"] = support.appendingPathComponent("R-library").path
        env["MPLCONFIGDIR"] = support.appendingPathComponent("matplotlib").path
        // Finder does not normally inherit a terminal's PATH.
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env.removeValue(forKey:"PYTHONHOME")
        env.removeValue(forKey:"PYTHONPATH")
        task.environment = env
        let out = Pipe(), err = Pipe()
        outPipe = out; errPipe = err
        task.standardOutput = out; task.standardError = err
        buffer = ""; errorBuffer = ""; stopping = false
        process = task
        folder.stringValue = project.path
        status.stringValue = "Starting your local workspace…"
        chooseButton.isEnabled = false
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data:data,encoding:.utf8) else { return }
            DispatchQueue.main.async {
                guard let self = self, self.process === task else { return }
                self.buffer += text
                if self.studioURL == nil, let line = self.buffer.components(separatedBy:"\n").first(where:{$0.hasPrefix("Minimal Data Studio: http://localhost:")}),
                   let url = URL(string:String(line.dropFirst("Minimal Data Studio: ".count))) {
                    self.studioURL = url
                    self.startupTimer?.invalidate()
                    self.status.stringValue = "Minimal Data Studio is running locally."
                    self.openButton.isEnabled = true
                    self.chooseButton.isEnabled = true
                    self.openBrowser()
                }
                let lines = self.buffer.components(separatedBy:"\n")
                for line in lines.dropLast() where line.hasPrefix("MDS_PROJECT:") {
                    if let data = String(line.dropFirst("MDS_PROJECT:".count)).data(using:.utf8),
                       let info = try? JSONSerialization.jsonObject(with:data) as? [String:String],
                       let path = info["project"], let address = info["url"], let url = URL(string:address) {
                        self.currentProject = URL(fileURLWithPath:path)
                        self.defaults.set(path,forKey:"projectPath")
                        self.folder.stringValue = path
                        self.studioURL = url
                    }
                }
                self.buffer = String((lines.last ?? "").suffix(8000))
            }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data:data,encoding:.utf8) else { return }
            DispatchQueue.main.async { self?.errorBuffer = String(((self?.errorBuffer ?? "") + text).suffix(8000)) }
        }
        task.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self = self, self.process === proc, !self.stopping else { return }
                self.startupTimer?.invalidate()
                self.openButton.isEnabled = false
                self.chooseButton.isEnabled = true
                self.studioURL = nil
                self.status.stringValue = "Minimal Data Studio stopped."
                if proc.terminationStatus != 0 { self.showError(self.errorBuffer.isEmpty ? "Could not start the project. Try another folder." : self.errorBuffer) }
            }
        }
        do {
            try task.run()
            startupTimer = Timer.scheduledTimer(withTimeInterval:45,repeats:false) { [weak self] _ in
                guard let self = self, self.studioURL == nil else { return }
                self.stop()
                self.showError("Startup took too long. Choose a writable project folder and try again.\n" + self.errorBuffer)
            }
        } catch {
            chooseButton.isEnabled = true
            showError(error.localizedDescription)
        }
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
        stopping = true
        startupTimer?.invalidate()
        outPipe?.fileHandleForReading.readabilityHandler = nil
        errPipe?.fileHandleForReading.readabilityHandler = nil
        if let task = process, task.isRunning {
            task.terminate()
            let until = Date().addingTimeInterval(5)
            while task.isRunning && Date() < until { Thread.sleep(forTimeInterval:0.05) }
            if task.isRunning { kill(task.processIdentifier,SIGKILL) }
        }
        process = nil; studioURL = nil
        openButton?.isEnabled = false
        chooseButton?.isEnabled = true
    }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func applicationWillTerminate(_ notification:Notification) { stop() }
}
let application = NSApplication.shared
let delegate = StudioLauncher()
application.delegate = delegate
application.run()
