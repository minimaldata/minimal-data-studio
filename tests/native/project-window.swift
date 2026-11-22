import Cocoa
// Compile with ProjectWindow.swift; this stub supplies the launcher's button type.
final class StudioButton: NSButton {}
@main struct ProjectWindowPolicyChecks {
    static func main() {
        let root = URL(string:"http://localhost:54321")!
        for allowed in ["http://localhost:54321/", "http://localhost:54321/#start", "http://localhost:54321/project-files"] {
            precondition(ProjectWindowController.isProjectURL(URL(string:allowed)!,address:root))
        }
        for blocked in ["https://localhost:54321/", "http://localhost:54322/", "https://example.com/", "file:///tmp/project", "http://user:password@localhost:54321/"] {
            precondition(!ProjectWindowController.isProjectURL(URL(string:blocked)!,address:root))
        }
        print("Project window origin and reconnect policy checks passed")
    }
}
