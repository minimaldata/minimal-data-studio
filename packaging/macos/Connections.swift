import Cocoa
import WebKit

func studioConnectionsDirectory() -> URL {
    let env=ProcessInfo.processInfo.environment
    if let path=env["MDS_CONNECTIONS_DIR"] { return URL(fileURLWithPath:path) }
    if let path=env["MDS_PROJECT_REGISTRY"] { return URL(fileURLWithPath:path).deletingLastPathComponent().appendingPathComponent("connections") }
    return FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Minimal Data Studio/connections")
}

/// Reuses the browser connection editor in a native window, independently of user projects.
final class ConnectionsController: NSObject, WKUIDelegate {
    private var window:NSWindow?
    private var task:Process?
    private var web:WKWebView?
    private let bridge:TaskCredentials
    init(bridge:TaskCredentials) { self.bridge=bridge }
    func open() {
        if let window=window { window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);return }
        guard let resources=Bundle.main.resourceURL else{return}
        let root=studioConnectionsDirectory().deletingLastPathComponent().appendingPathComponent("connection-manager")
        do {
            try FileManager.default.createDirectory(at:root.appendingPathComponent(".studio"),withIntermediateDirectories:true)
            try Data("{\"sampleData\":false,\"sampleNotebooks\":false}".utf8).write(to:root.appendingPathComponent(".studio/creation-options.json"))
        } catch { return }
        let config=WKWebViewConfiguration();let view=WKWebView(frame:.zero,configuration:config);view.uiDelegate=self;web=view
        let win=NSWindow(contentRect:NSRect(x:0,y:0,width:840,height:680),styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false);win.title="Connections — Minimal Data Studio";win.isReleasedWhenClosed=false;win.contentView=view;win.center();win.makeKeyAndOrderFront(nil);window=win
        view.loadHTMLString("<body style='font:16px system-ui;padding:32px'>Opening Connections…</body>",baseURL:nil)
        let proc=Process();task=proc;proc.executableURL=resources.appendingPathComponent("python/bin/python3")
        proc.arguments=[resources.appendingPathComponent("studio/serve.py").path,"--project-dir",root.path,"--port","0"]
        var env=ProcessInfo.processInfo.environment;env["MDS_CONNECTIONS_DIR"]=studioConnectionsDirectory().path;env["MDS_PROJECT_REGISTRY"]=root.appendingPathComponent("registry.json").path;env["MDS_TASK_BRIDGE"]="1";env["PYTHONUNBUFFERED"]="1";env["PYTHONNOUSERSITE"]="1";env["PYTHONDONTWRITEBYTECODE"]="1";env["PATH"]="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";env.removeValue(forKey:"PYTHONPATH");env.removeValue(forKey:"PYTHONHOME");proc.environment=env
        let out=Pipe(),input=Pipe(),err=Pipe();proc.standardOutput=out;proc.standardInput=input;proc.standardError=err
        var buffered=""
        out.fileHandleForReading.readabilityHandler={ [weak self] h in
            let data=h.availableData;if data.isEmpty{return};let text=String(data:data,encoding:.utf8) ?? ""
            DispatchQueue.main.async { guard let self=self else{return};buffered+=text
                while let range=buffered.range(of:"\n") { let line=String(buffered[..<range.lowerBound]);buffered.removeSubrange(..<range.upperBound)
                    if line.hasPrefix("MDS_TASK_CREDENTIALS:"){self.bridge.respond(line:line,project:root.path,input:input.fileHandleForWriting)}
                    if line.hasPrefix("Minimal Data Studio: "),let url=URL(string:String(line.dropFirst("Minimal Data Studio: ".count))+"/#connections-manager"){view.load(URLRequest(url:url))}
                }
            }
        }
        err.fileHandleForReading.readabilityHandler={h in _=h.availableData}
        proc.terminationHandler={ [weak self] _ in out.fileHandleForReading.readabilityHandler=nil;err.fileHandleForReading.readabilityHandler=nil;DispatchQueue.main.async{self?.task=nil;self?.web?.loadHTMLString("<body style='font:16px system-ui;padding:32px'>Connections stopped. Close and reopen Studio to try again.</body>",baseURL:nil)}}
        do { try proc.run() } catch { view.loadHTMLString("<body>Could not start Connections. Reopen Studio to try again.</body>",baseURL:nil) }
    }
    func stop(){if task?.isRunning == true{task?.terminate()}}
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? {if let url=navigationAction.request.url,["https","http"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)};return nil}
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){let a=NSAlert();a.messageText=message;a.addButton(withTitle:"Continue");a.addButton(withTitle:"Cancel");completionHandler(a.runModal() == .alertFirstButtonReturn)}
}
