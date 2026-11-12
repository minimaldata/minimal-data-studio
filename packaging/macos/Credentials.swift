import Cocoa
import Security
import LocalAuthentication

struct StudioCredential {
    let id: String
    let name: String
}

/// Secret values never enter project files, preferences, HTTP endpoints or logs.
final class StudioKeychain {
    let service = (Bundle.main.bundleIdentifier ?? "com.minimaldata.studio.development") + ".credentials.v1"
    private func query(_ id: String? = nil) -> [String:Any] {
        var value: [String:Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrSynchronizable as String:false]
        if let id = id { value[kSecAttrAccount as String] = id }
        return value
    }
    private func check(_ status: OSStatus) throws {
        if status != errSecSuccess {
            throw NSError(domain:"StudioKeychain",code:Int(status),userInfo:[NSLocalizedDescriptionKey:(SecCopyErrorMessageString(status,nil) as String?) ?? "Keychain could not complete this action."])
        }
    }
    func list() throws -> [StudioCredential] {
        var q = query(); q[kSecReturnAttributes as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary,&result)
        if status == errSecItemNotFound { return [] }; try check(status)
        return (result as? [[String:Any]] ?? []).compactMap { item in
            guard let id = item[kSecAttrAccount as String] as? String, let name = item[kSecAttrLabel as String] as? String else { return nil }
            return StudioCredential(id:id,name:name)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
    func add(name:String, value:String) throws {
        if try list().contains(where:{$0.name.caseInsensitiveCompare(name) == .orderedSame}) {
            throw NSError(domain:"StudioKeychain",code:1,userInfo:[NSLocalizedDescriptionKey:"That credential name already exists. Select it and choose Replace."])
        }
        var q = query(UUID().uuidString); q[kSecAttrLabel as String] = name
        q[kSecValueData as String] = Data(value.utf8)
        try check(SecItemAdd(q as CFDictionary,nil))
    }
    func replace(_ item:StudioCredential, value:String) throws {
        try check(SecItemUpdate(query(item.id) as CFDictionary,[kSecValueData as String:Data(value.utf8)] as CFDictionary))
    }
    func remove(_ item:StudioCredential) throws { try check(SecItemDelete(query(item.id) as CFDictionary)) }
    func read(_ item:StudioCredential) throws -> String {
        var q = query(item.id); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; try check(SecItemCopyMatching(q as CFDictionary,&result))
        guard let data = result as? Data, let value = String(data:data,encoding:.utf8) else {
            throw NSError(domain:"StudioKeychain",code:2,userInfo:[NSLocalizedDescriptionKey:"This credential could not be decoded."])
        }
        return value
    }
}

final class CredentialsController: NSWindowController, NSWindowDelegate, NSSearchFieldDelegate {
    private let keychain = StudioKeychain()
    private let projects = CredentialProjects()
    private let search = NSSearchField()
    private let projectPicker = NSPopUpButton()
    private let scope = NSSegmentedControl(labels:["All credentials", "This project"],trackingMode:.selectOne,target:nil,action:nil)
    private var projectPaths: [String] = []
    private var selectedProject: String? { projectPicker.selectedItem?.representedObject as? String }
    private let rows = NSStackView()
    private let message = NSTextField(wrappingLabelWithString:"")
    private let secret = NSTextField(wrappingLabelWithString:"")
    private var items: [StudioCredential] = []
    private var revealTimer: Timer?
    private var authentication: LAContext?
    private var generation = 0

    init() {
        let window = NSWindow(contentRect:NSRect(x:0,y:0,width:820,height:500),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
        super.init(window:window); window.title = "Credentials"; window.delegate = self; window.minSize = NSSize(width:720,height:440)
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false; window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:window.contentView!.leadingAnchor,constant:24),stack.trailingAnchor.constraint(equalTo:window.contentView!.trailingAnchor,constant:-24),stack.topAnchor.constraint(equalTo:window.contentView!.topAnchor,constant:24),stack.bottomAnchor.constraint(equalTo:window.contentView!.bottomAnchor,constant:-24)])
        let heading = NSTextField(labelWithString:"Credentials"); heading.font = .boldSystemFont(ofSize:24); stack.addArrangedSubview(heading)
        let note = NSTextField(wrappingLabelWithString:"Stored in this Mac’s Keychain, outside your projects. Approve task access separately when you run a script.")
        note.textColor = .secondaryLabelColor; stack.addArrangedSubview(note)
        let controls = NSStackView(); controls.spacing = 10
        search.placeholderString = "Search credentials or projects"; search.delegate = self
        search.setAccessibilityLabel("Search credentials or projects")
        controls.addArrangedSubview(search); search.widthAnchor.constraint(greaterThanOrEqualToConstant:260).isActive = true
        controls.addArrangedSubview(NSButton(title:"Add credential…",target:self,action:#selector(addCredential)))
        stack.addArrangedSubview(controls)
        let filters = NSStackView(); filters.spacing = 10
        scope.selectedSegment = 0; scope.target = self; scope.action = #selector(filterChanged)
        filters.addArrangedSubview(scope); filters.addArrangedSubview(NSTextField(labelWithString:"Project:"))
        projectPicker.target = self; projectPicker.action = #selector(filterChanged); projectPicker.setAccessibilityLabel("Credential project")
        projectPicker.widthAnchor.constraint(equalToConstant:330).isActive = true
        filters.addArrangedSubview(projectPicker); stack.addArrangedSubview(filters)
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        rows.orientation = .vertical; rows.alignment = .leading; rows.spacing = 10; rows.translatesAutoresizingMaskIntoConstraints = false
        let flipped = ProjectListStack(); flipped.orientation = .vertical; flipped.alignment = .leading; flipped.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = flipped; flipped.addArrangedSubview(rows)
        NSLayoutConstraint.activate([flipped.widthAnchor.constraint(equalTo:scroll.contentView.widthAnchor),rows.widthAnchor.constraint(equalTo:flipped.widthAnchor)])
        stack.addArrangedSubview(scroll); scroll.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant:100).isActive = true
        secret.font = .monospacedSystemFont(ofSize:13,weight:.regular); secret.isSelectable = false; secret.isHidden = true
        stack.addArrangedSubview(secret); message.textColor = .secondaryLabelColor; stack.addArrangedSubview(message)
        window.center()
        NotificationCenter.default.addObserver(self,selector:#selector(hideSecret),name:NSApplication.didResignActiveNotification,object:nil)
    }
    required init?(coder:NSCoder) { fatalError("init(coder:) is not supported") }
    func open(projectPaths:[String], current:String?) {
        hideSecret()
        let previous = selectedProject
        self.projectPaths = Array(Set(projectPaths)).sorted()
        projectPicker.removeAllItems(); projectPicker.addItem(withTitle:"Choose a project…")
        for path in self.projectPaths {
            projectPicker.addItem(withTitle:path)
            projectPicker.lastItem?.representedObject = path
            projectPicker.lastItem?.toolTip = path
        }
        if let path = current ?? previous, let index = self.projectPaths.firstIndex(of:path) { projectPicker.selectItem(at:index + 1) }
        reload(); showWindow(nil); window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }
    func controlTextDidChange(_ notification:Notification) { renderRows() }
    @objc private func filterChanged() { hideSecret(); generation += 1; authentication?.invalidate(); renderRows() }
    private func error(_ error:Error) { message.stringValue = error.localizedDescription; message.textColor = .systemRed }
    private func reload() {
        do { items = try keychain.list(); renderRows() }
        catch { self.error(error) }
    }
    private func renderRows() {
        rows.arrangedSubviews.forEach { rows.removeArrangedSubview($0); $0.removeFromSuperview() }
        let term = search.stringValue.trimmingCharacters(in:.whitespacesAndNewlines)
        let visible = items.filter { item in
            let inProject = selectedProject.map { projects.connected(item.id,to:$0) } ?? false
            let matches = term.isEmpty || ([item.name] + projects.paths(for:item.id)).contains { $0.localizedCaseInsensitiveContains(term) }
            return matches && (scope.selectedSegment == 0 || inProject)
        }
        if visible.isEmpty {
            let text = scope.selectedSegment == 1 && selectedProject == nil ? "Choose a project to see its credentials." : items.isEmpty ? "No credentials yet." : "No matching credentials. Use All credentials to connect an existing key."
            rows.addArrangedSubview(NSTextField(wrappingLabelWithString:text))
        }
        for item in visible {
            let row = NSStackView(); row.spacing = 8
            let details = NSStackView(); details.orientation = .vertical; details.alignment = .leading; details.spacing = 3
            let label = NSTextField(labelWithString:item.name); label.font = .systemFont(ofSize:14,weight:.medium)
            details.addArrangedSubview(label)
            let paths = projects.paths(for:item.id)
            let usage = NSTextField(wrappingLabelWithString:paths.isEmpty ? "Not connected to a project" : "Used by: " + paths.map { URL(fileURLWithPath:$0).lastPathComponent }.joined(separator:", "))
            usage.font = .systemFont(ofSize:11); usage.textColor = .secondaryLabelColor; usage.toolTip = paths.joined(separator:"\n")
            details.addArrangedSubview(usage); row.addArrangedSubview(details)
            details.widthAnchor.constraint(greaterThanOrEqualToConstant:200).isActive = true
            details.setContentCompressionResistancePriority(.defaultLow,for:.horizontal)
            row.addArrangedSubview(NSView())
            let connected = selectedProject.map { projects.connected(item.id,to:$0) } ?? false
            let connect = NSButton(title:connected ? "Disconnect" : "Connect",target:self,action:#selector(toggleConnection(_:)))
            connect.identifier = NSUserInterfaceItemIdentifier(item.id); connect.isEnabled = selectedProject != nil
            connect.toolTip = selectedProject.map { (connected ? "Disconnect from " : "Connect to ") + $0 } ?? "Choose a project first"
            row.addArrangedSubview(connect)
            for (title,action) in [("Reveal",#selector(reveal(_:))),("Replace…",#selector(replace(_:))),("Remove…",#selector(remove(_:)))] {
                let button = NSButton(title:title,target:self,action:action); button.identifier = NSUserInterfaceItemIdentifier(item.id); row.addArrangedSubview(button)
            }
            rows.addArrangedSubview(row); row.widthAnchor.constraint(equalTo:rows.widthAnchor).isActive = true
        }
        message.textColor = .secondaryLabelColor
        message.stringValue = "One Keychain value, shared by connected projects. Each task needs explicit credential approval."
    }
    @objc private func toggleConnection(_ sender:NSButton) {
        guard let item = item(sender), let path = selectedProject else { return }; hideSecret()
        do {
            if projects.connected(item.id,to:path) { projects.disconnect(item.id,from:path) }
            else { try projects.connect(item.id,to:path) }
            renderRows()
        } catch { self.error(error) }
    }
    private func item(_ sender:NSButton) -> StudioCredential? { items.first {$0.id == sender.identifier?.rawValue} }
    private func edit(_ item:StudioCredential?) {
        hideSecret()
        let alert = NSAlert(); alert.messageText = item == nil ? "Add credential" : "Replace \(item!.name)"
        alert.informativeText = "The secret is saved only in this Mac’s Keychain."
        if let item = item, !projects.paths(for:item.id).isEmpty {
            alert.informativeText += " Replacing it changes the value for these projects:\n" + projects.paths(for:item.id).joined(separator:"\n")
        }
        let fields = NSStackView(frame:NSRect(x:0,y:0,width:380,height:64)); fields.orientation = .vertical; fields.alignment = .leading; fields.spacing = 8
        let name = NSTextField(string:item?.name ?? ""); name.placeholderString = "Name, e.g. ORDERS_API_TOKEN"; name.isEditable = item == nil
        let value = NSSecureTextField(string:""); value.placeholderString = "Secret value"
        fields.addArrangedSubview(name); fields.addArrangedSubview(value)
        name.widthAnchor.constraint(equalToConstant:380).isActive = true; value.widthAnchor.constraint(equalToConstant:380).isActive = true
        alert.accessoryView = fields; alert.window.initialFirstResponder = item == nil ? name : value; alert.addButton(withTitle:"Save"); alert.addButton(withTitle:"Cancel")
        defer { value.stringValue = "" }
        while alert.runModal() == .alertFirstButtonReturn {
            let label = name.stringValue.trimmingCharacters(in:.whitespacesAndNewlines)
            guard !label.isEmpty, label.count <= 100, !value.stringValue.isEmpty else {
                alert.informativeText = "Enter a name (up to 100 characters) and a secret value."; continue
            }
            do {
                if let item = item { try keychain.replace(item,value:value.stringValue) }
                else { try keychain.add(name:label,value:value.stringValue) }
                reload(); return
            } catch { alert.informativeText = error.localizedDescription }
        }
    }
    @objc private func addCredential() { edit(nil) }
    @objc private func replace(_ sender:NSButton) { if let item = item(sender) { edit(item) } }
    @objc private func remove(_ sender:NSButton) {
        guard let item = item(sender) else { return }; hideSecret()
        let alert = NSAlert(); alert.messageText = "Remove \(item.name)?"; alert.informativeText = "This removes the saved secret from this Mac. It does not revoke the key at its provider. This cannot be undone."
        let affected = projects.paths(for:item.id)
        if !affected.isEmpty { alert.informativeText += "\nConnected projects:\n" + affected.joined(separator:"\n") }
        alert.addButton(withTitle:"Remove"); alert.addButton(withTitle:"Cancel")
        if alert.runModal() == .alertFirstButtonReturn { do { try keychain.remove(item); projects.remove(item.id); reload() } catch { self.error(error) } }
    }
    @objc private func reveal(_ sender:NSButton) {
        guard let item = item(sender) else { return }; hideSecret()
        generation += 1; authentication?.invalidate()
        let context = LAContext(); authentication = context; let token = generation
        // Fresh context for every reveal; no reuse of previous authentication.
        context.touchIDAuthenticationAllowableReuseDuration = 0
        var failure:NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication,error:&failure) else {
            message.stringValue = "Mac authentication is unavailable. The secret remains hidden."; return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication,localizedReason:"Reveal \(item.name) in Minimal Data Studio") { [weak self] success, failure in
            DispatchQueue.main.async {
                guard let self = self, self.generation == token else { return }
                self.authentication = nil
                guard success, self.window?.isVisible == true else { self.message.stringValue = "Authentication cancelled or unsuccessful. The secret remains hidden."; return }
                do {
                    self.secret.stringValue = try self.keychain.read(item); self.secret.isHidden = false
                    self.message.stringValue = "\(item.name) · hides in 20 seconds"
                    self.revealTimer = Timer.scheduledTimer(withTimeInterval:20,repeats:false) { [weak self] _ in self?.hideSecret() }
                } catch { self.error(error) }
            }
        }
    }
    @objc private func hideSecret() {
        // OS authentication may temporarily take focus: cancel on window close,
        // but do not invalidate its own prompt when the app resigns active.
        if !secret.isHidden { message.stringValue = "Secret hidden. Reveal requires Mac authentication." }
        secret.stringValue = ""; secret.isHidden = true; revealTimer?.invalidate(); revealTimer = nil
    }
    func windowDidResignKey(_ notification:Notification) { hideSecret() }
    func windowWillClose(_ notification:Notification) { hideSecret(); generation += 1; authentication?.invalidate(); authentication = nil }
}
