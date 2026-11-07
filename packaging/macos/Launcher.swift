import Cocoa

final class StudioLauncher: NSObject, NSApplicationDelegate {
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
    let defaults = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu()
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
        if let path = defaults.string(forKey:"projectPath"), FileManager.default.fileExists(atPath:path) {
            start(URL(fileURLWithPath:path,isDirectory:true))
        } else {
            chooseProject()
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
            stop()
            defaults.set(url.path,forKey:"projectPath")
            start(url)
        }
    }

    func start(_ project: URL) {
        guard let resources = Bundle.main.resourceURL else { return }
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
                    self.status.stringValue = "Studio is running locally."
                    self.openButton.isEnabled = true
                    self.chooseButton.isEnabled = true
                    self.openBrowser()
                }
                self.buffer = String(self.buffer.suffix(8000))
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
                self.status.stringValue = "Studio stopped."
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
        status.stringValue = "Could not open Studio."
        let alert = NSAlert()
        alert.messageText = "Minimal Data Studio could not start"
        alert.informativeText = text
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
