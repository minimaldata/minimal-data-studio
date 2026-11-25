// Append to the combined launcher sources, replacing its final application entry point.
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let short = studioErrorAlert(title:"Short error",details:"Could not open the project.")
precondition(short.accessoryView == nil)
let details = String(repeating:"127.0.0.1 GET /project-health HTTP/1.1 200\n",count:1000) + String(repeating:"x",count:5000)
let alert = studioErrorAlert(title:"Long error layout test",details:details)
guard let scroll = alert.accessoryView as? NSScrollView, let text = scroll.documentView as? NSTextView else { fatalError("Missing scrollable diagnostics") }
precondition(text.string == details && text.isSelectable && !text.isEditable)
precondition(scroll.hasVerticalScroller && scroll.frame.height <= 260)
alert.layout()
precondition(alert.window.frame.height < (NSScreen.main?.visibleFrame.height ?? 600))
precondition(alert.buttons[0].title == "Close")
if CommandLine.arguments.contains("--show") {
    application.activate(ignoringOtherApps:true)
    alert.runModal()
}
print("PASS: bounded long error, complete selectable log, visible Close button; short errors unchanged")
