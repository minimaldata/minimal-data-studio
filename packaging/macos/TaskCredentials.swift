import Cocoa
import CryptoKit

/// Only inherited parent/child pipes carry values. No URL handler or HTTP reveal API.
final class TaskCredentials {
    var manage: ((String) -> Void)?
    private let keychain = StudioKeychain()
    private let projects = CredentialProjects()
    func respond(line:String, project:String, input:FileHandle) {
        let prefix = "MDS_TASK_CREDENTIALS:"
        guard line.hasPrefix(prefix), line.utf8.count < 50000,
              let data = String(line.dropFirst(prefix.count)).data(using:.utf8),
              let request = try? JSONSerialization.jsonObject(with:data) as? [String:Any],
              let requestID = request["requestID"] as? String else { return }
        var response: [String:Any] = ["requestID":requestID]
        do {
            if request["operation"] as? String == "manage" {
                guard let manage = manage else { throw failure("Credential manager is unavailable.") }
                manage(project)
                response["opened"] = true
            } else {
            let available = try keychain.list().filter { projects.connected($0.id,to:project) }
            if request["operation"] as? String == "list" {
                response["credentials"] = available.map { ["id":$0.id,"name":$0.name] }
            } else {
                guard request["operation"] as? String == "resolve", let task = request["task"] as? [String:Any],
                      let taskID = task["id"] as? String, let name = task["name"] as? String,
                      let script = task["script"] as? String, let hash = request["hash"] as? String,
                      let runtime = request["runtime"] as? String, let bindings = task["credentials"] as? [[String:String]],
                      !bindings.isEmpty, bindings.count <= 20 else { throw failure("Invalid credential request.") }
                let root = URL(fileURLWithPath:project).resolvingSymlinksInPath()
                let path = root.appendingPathComponent(script).standardizedFileURL.resolvingSymlinksInPath()
                guard path.path.hasPrefix(root.path + "/"), path.pathExtension == "py",
                      let code = try? Data(contentsOf:path), code.count <= 2000000,
                      SHA256.hash(data:code).map({String(format:"%02x",$0)}).joined() == hash else {
                    throw failure("Script changed or is outside the project. Save it, then run again.")
                }
                let chosen = try bindings.map { binding -> (StudioCredential,String) in
                    guard let id = binding["id"], let env = binding["env"],
                          env.range(of:"^[A-Z][A-Z0-9_]{0,99}$",options:.regularExpression) != nil,
                          !["PATH","HOME","SHELL","USER","TMPDIR"].contains(env),
                          !["PYTHON","MDS_","DYLD_","LD_"].contains(where:env.hasPrefix),
                          let item = available.first(where:{$0.id == id}) else { throw failure("A selected credential is not connected to this project. Open Credentials in the project manager.") }
                    return (item,env)
                }
                let identity = CredentialProjects.identity(project) ?? ""
                let fingerprintData = try JSONSerialization.data(withJSONObject:["project":identity,"task":taskID,"script":script,"hash":hash,"runtime":runtime,"bindings":bindings],options:.sortedKeys)
                let grant = "taskCredentialGrant.v1." + SHA256.hash(data:fingerprintData).map { String(format:"%02x",$0) }.joined()
                if !UserDefaults.standard.bool(forKey:grant) {
                    if request["allowPrompt"] as? Bool == false { throw failure("Scheduled task needs approval. Run it manually first, then resume its schedule.") }
                    NSApp.activate(ignoringOtherApps:true)
                    let alert = NSAlert(); alert.messageText = "Allow credentials for \(name)?"
                    alert.informativeText = "Project: \(project)\nScript: \(script)\nPython: \(runtime)\n\n" + chosen.map { "\($0.0.name) → \($0.1)" }.joined(separator:"\n") + "\n\nThis script and code it imports receive the actual secrets and can send them elsewhere. Approve only code you trust. Editing the script, runtime or credential selection requires approval again."
                    alert.addButton(withTitle:"Allow this task");alert.addButton(withTitle:"Cancel")
                    guard alert.runModal() == .alertFirstButtonReturn else { throw failure("Credential access was not approved. No script ran.") }
                    UserDefaults.standard.set(true,forKey:grant)
                }
                var values: [String:String] = [:]
                for (item,env) in chosen { values[env] = try keychain.read(item) }
                response["values"] = values
            }
            }
        } catch { response["error"] = error.localizedDescription }
        if let data = try? JSONSerialization.data(withJSONObject:response), var output = String(data:data,encoding:.utf8) {
            output += "\n"; try? input.write(contentsOf:Data(output.utf8))
        }
    }
    private func failure(_ message:String) -> NSError { NSError(domain:"TaskCredentials",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
}
