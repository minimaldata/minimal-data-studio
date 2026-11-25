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
        for embedded in ["about:blank", "about:srcdoc"] {
            precondition(ProjectWindowController.isEmbeddedDocument(URL(string:embedded)!,isMainFrame:false))
            precondition(!ProjectWindowController.isEmbeddedDocument(URL(string:embedded)!,isMainFrame:true))
        }
        for blocked in ["about:config", "https://example.com", "file:///tmp/app.html", "data:text/html,test"] {
            precondition(!ProjectWindowController.isEmbeddedDocument(URL(string:blocked)!,isMainFrame:false))
        }
        print("Project window origin and reconnect policy checks passed")
    }
}
