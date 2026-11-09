import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.activate(ignoringOtherApps:true)
let create = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "create"
let panel: NSSavePanel
if create {
    panel = NSSavePanel()
    panel.title = "Create a new Studio project"
    panel.nameFieldLabel = "Project name:"
    panel.nameFieldStringValue = "Untitled project"
    panel.prompt = "Choose location"
    panel.message = "Choose a name and location for the new project folder."
} else {
    let picker = NSOpenPanel()
    picker.canChooseDirectories = true
    picker.canChooseFiles = false
    picker.allowsMultipleSelection = false
    picker.title = "Choose a project folder"
    picker.prompt = "Choose folder"
    panel = picker
}
panel.canCreateDirectories = true
if CommandLine.arguments.count > 1 {
    panel.directoryURL = URL(fileURLWithPath:CommandLine.arguments[1])
}
let selected = panel.runModal() == .OK ? panel.url?.resolvingSymlinksInPath().path : nil
let result: [String:Any] = selected.map { ["path":$0] } ?? ["cancelled":true]
let data = try JSONSerialization.data(withJSONObject:result)
print(String(data:data,encoding:.utf8)!)
