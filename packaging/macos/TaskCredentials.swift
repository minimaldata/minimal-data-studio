import Cocoa
import CryptoKit

/// Only inherited parent/child pipes carry values. No URL handler or HTTP reveal API.
final class TaskCredentials {
    var manage: ((String) -> Void)?
    var manageConnections: (() -> Void)?
    private let keychain: StudioKeychain
    private let projects: CredentialProjects
    private let defaults: UserDefaults
    init(keychain:StudioKeychain = StudioKeychain(), projects:CredentialProjects = CredentialProjects(), defaults:UserDefaults = .standard) {
        self.keychain=keychain;self.projects=projects;self.defaults=defaults
    }
    func respond(line:String, project:String, input:FileHandle) {
        let prefix = "MDS_TASK_CREDENTIALS:"
        guard line.hasPrefix(prefix), line.utf8.count < 50000,
              let data = String(line.dropFirst(prefix.count)).data(using:.utf8),
              let request = try? JSONSerialization.jsonObject(with:data) as? [String:Any],
              let requestID = request["requestID"] as? String else { return }
        var response: [String:Any] = ["requestID":requestID]
        do {
            if request["operation"] as? String == "choose-ssh-key" {
                NSApp.activate(ignoringOtherApps:true)
                let panel=NSOpenPanel();panel.title="Choose SSH private key";panel.canChooseDirectories=false;panel.allowsMultipleSelection=false;panel.showsHiddenFiles=true
                panel.directoryURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ssh")
                if panel.runModal() == .OK, let url=panel.url { response["path"]=url.resolvingSymlinksInPath().path }
                else { response["cancelled"]=true }
            } else if request["operation"] as? String == "manage-connections" {
                guard let open=manageConnections else {throw failure("Connections manager unavailable.")};open();response["opened"]=true
            } else if request["operation"] as? String == "manage" {
                guard let manage = manage else { throw failure("Credential manager is unavailable.") }
                manage(project)
                response["opened"] = true
            } else {
            let available = try keychain.list().filter { projects.connected($0.id,to:project) }
            if request["operation"] as? String == "list-connections" {
                response["credentials"] = try keychain.list().map { ["id":$0.id,"name":$0.name] }
            } else if request["operation"] as? String == "list" {
                response["credentials"] = available.map { ["id":$0.id,"name":$0.name] }
            } else if ["resolve-connection","resolve-central-connection","resolve-draft-connection"].contains(request["operation"] as? String ?? "") {
                response["values"] = try resolveConnection(request,project:project,available:available)
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
                if !defaults.bool(forKey:grant) {
                    if request["allowPrompt"] as? Bool == false { throw failure("Scheduled task needs approval. Run it manually first, then resume its schedule.") }
                    NSApp.activate(ignoringOtherApps:true)
                    let alert = NSAlert(); alert.messageText = "Allow credentials for \(name)?"
                    alert.informativeText = "Project: \(project)\nScript: \(script)\nPython: \(runtime)\n\n" + chosen.map { "\($0.0.name) → \($0.1)" }.joined(separator:"\n") + "\n\nThis script and code it imports receive the actual secrets and can send them elsewhere. Approve only code you trust. Editing the script, runtime or credential selection requires approval again."
                    alert.addButton(withTitle:"Allow this task");alert.addButton(withTitle:"Cancel")
                    guard alert.runModal() == .alertFirstButtonReturn else { throw failure("Credential access was not approved. No script ran.") }
                    defaults.set(true,forKey:grant)
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
    private func resolveConnection(_ request:[String:Any],project:String,available:[StudioCredential]) throws -> [String:String] {
        guard let supplied = request["connection"] as? [String:Any],
              let id = supplied["id"] as? String else { throw failure("Invalid database credential request.") }
        let centralTest=request["operation"] as? String == "resolve-central-connection"
        let draftTest=request["operation"] as? String == "resolve-draft-connection"
        var saved:[String:Any]
        var allowed=available
        var sharedID:String?
        if draftTest {
            guard id.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil,
                  supplied.count<=24,
                  supplied.values.allSatisfy({ value in
                      if let text=value as? String { return text.count<=1024 && !text.unicodeScalars.contains(where:CharacterSet.controlCharacters.contains) }
                      return value is Int
                  }) else {throw failure("Invalid temporary connection settings.")}
            saved=supplied;allowed=try keychain.list()
        } else if centralTest { saved=[:];sharedID=id }
        else {
            let root=URL(fileURLWithPath:project).resolvingSymlinksInPath()
            let path=root.appendingPathComponent(".studio/connections.json").resolvingSymlinksInPath()
            guard path.path.hasPrefix(root.path + "/"),let data=try? Data(contentsOf:path),data.count<2_000_000,
                  let state=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let entries=state["connections"] as? [[String:Any]],
                  let link=entries.first(where:{$0["id"] as? String == id}) else {throw failure("Connection is not attached to this project.")}
            saved=link;sharedID=link["connectionId"] as? String
        }
        if let sharedID=sharedID {
            let central=studioConnectionsDirectory().appendingPathComponent("connections.json")
            guard let bytes=try? Data(contentsOf:central),bytes.count<10_000_000,let registry=try? JSONSerialization.jsonObject(with:bytes) as? [String:Any],let entries=registry["connections"] as? [[String:Any]],let match=entries.first(where:{$0["id"] as? String == sharedID}) else {throw failure("Reconnect this connection on this Mac.")}
            saved=match;saved["id"]=id;allowed=try keychain.list()
        }
        guard
              ((saved["provider"] as? String == "snowflake" && saved["authentication"] as? String == "password_mfa") || (saved["provider"] as? String == "postgres" && ["supabase","direct"].contains(saved["preset"] as? String ?? ""))),
              let credentialID = saved["credentialId"] as? String,
              let credential = allowed.first(where:{$0.id == credentialID}) else {
            throw failure("Save the database connection and connect its password to this project in Credentials first.")
        }
        // A browser request cannot redirect a saved password to another account/user/role.
        let postgres = saved["provider"] as? String == "postgres"
        let fields = postgres ? ["id","name","provider","preset","host","user","database","credentialId","sslrootcert"] : ["id","name","provider","authentication","account","user","role","warehouse","database","credentialId","mfaMethod"]
        var context:[String:String] = ["project":draftTest ? "unsaved-connection-test" : centralTest ? "central-connection-test" : (CredentialProjects.identity(project) ?? "")]
        for field in fields {
            guard let value = saved[field] as? String, supplied[field] as? String == value else {
                throw failure("Connection settings changed. Save and reconnect before using its password.")
            }
            context[field] = value
        }
        if postgres {
            guard let port=saved["port"] as? Int, (1...65535).contains(port), supplied["port"] as? Int == port else { throw failure("Connection port changed. Save and reconnect.") }
            context["port"] = String(port)
        } else { context["mfaCaching"] = "automatic" }
        if let sshHost=saved["sshHost"] as? String {
            guard postgres, saved["preset"] as? String == "direct" else {throw failure("SSH tunnels require a direct Postgres connection.")}
            for field in ["sshHost","sshUser","sshKeyPath","sshPassphraseId"] {
                guard let value=saved[field] as? String, supplied[field] as? String == value else {throw failure("SSH settings changed. Save and reconnect.")}
                context[field]=value
            }
            guard let port=saved["sshPort"] as? Int, (1...65535).contains(port), supplied["sshPort"] as? Int == port,
                  let serverFingerprint=supplied["sshServerFingerprint"] as? String,
                  serverFingerprint.range(of:"^SHA256:[A-Za-z0-9+/]{43}$",options:.regularExpression) != nil else {throw failure("Invalid SSH server identity.")}
            context["sshPort"]=String(port)
            let identity=Data("\(sshHost.lowercased()):\(port)".utf8)
            let pin="sshServerPin.v1."+SHA256.hash(data:identity).map{String(format:"%02x",$0)}.joined()
            if let known=defaults.string(forKey:pin) {
                guard known==serverFingerprint else {throw failure("SSH server identity changed. Ask your administrator to verify the server before reconnecting.")}
            } else {
                NSApp.activate(ignoringOtherApps:true)
                let alert=NSAlert();alert.messageText="Trust this SSH server?"
                alert.informativeText="Server: \(sshHost):\(port)\nFingerprint: \(serverFingerprint)\n\nConfirm this fingerprint with your administrator before trusting it. Studio will remember it on this Mac and block a different key."
                alert.addButton(withTitle:"Trust server");alert.addButton(withTitle:"Cancel")
                guard alert.runModal() == .alertFirstButtonReturn else {throw failure("SSH server was not trusted. No credentials were sent.")}
                defaults.set(serverFingerprint,forKey:pin)
            }
        } else if supplied["sshHost"] != nil {throw failure("Save SSH settings before connecting.")}
        let fingerprint = try JSONSerialization.data(withJSONObject:context,options:.sortedKeys)
        let grant = "connectionCredentialGrant.v1." + SHA256.hash(data:fingerprint).map{String(format:"%02x",$0)}.joined()
        let accessContext=draftTest ? "Unsaved connection test (one-time approval; nothing saved)" : centralTest ? "Central connection test (no project grant)" : "Project: \(project)"
        if draftTest || !defaults.bool(forKey:grant) {
            if request["allowPrompt"] as? Bool == false {throw failure("This connection test requires native approval.")}
            NSApp.activate(ignoringOtherApps:true)
            let alert = NSAlert(); alert.messageText = "Allow password for \(context["name"]!)?"
            if postgres {
                alert.informativeText = "\(accessContext)\nHost: \(context["host"]!)\nDatabase: \(context["database"]!)\nUser: \(context["user"]!)\n\nUse Keychain credential ‘\(credential.name)’ for this Postgres connection? The password stays out of the browser and project files. Changing the destination requires approval again."
            } else {
            alert.informativeText = "\(accessContext)\nAccount: \(context["account"]!)\nUser: \(context["user"]!)\nRole: \(context["role"]!)\n\nUse Keychain credential ‘\(credential.name)’ to sign into this Snowflake connection. The password stays out of the browser and project files. Changing these connection settings requires approval again."
            alert.informativeText += "\n\nRemember MFA approval on this Mac: Snowflake may store an approval token in macOS Keychain for up to four hours, if your account permits it."
            }
            if let sshHost=context["sshHost"] {alert.informativeText += "\n\nSSH: \(context["sshUser"] ?? "")@\(sshHost):\(context["sshPort"] ?? "")\nPrivate key: \(context["sshKeyPath"] ?? "")"}
            alert.addButton(withTitle:"Allow this connection");alert.addButton(withTitle:"Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { throw failure("Credential access cancelled. No connection was opened.") }
            if !draftTest { defaults.set(true,forKey:grant) }
        }
        var values:[String:String] = [:]
        if context["mfaMethod"] == "passcode" {
            NSApp.activate(ignoringOtherApps:true)
            let alert = NSAlert();alert.messageText = "Snowflake MFA code"
            alert.informativeText = "Enter a current code for \(context["user"]!) at \(context["account"]!). This code is used once and is not saved."
            let field = NSSecureTextField(frame:NSRect(x:0,y:0,width:320,height:24));field.placeholderString = "MFA passcode"
            alert.accessoryView=field;alert.window.initialFirstResponder=field
            alert.addButton(withTitle:"Connect");alert.addButton(withTitle:"Cancel")
            defer { field.stringValue="" }
            guard alert.runModal() == .alertFirstButtonReturn, !field.stringValue.isEmpty else { throw failure("MFA entry cancelled. No connection was opened.") }
            values["passcode"] = field.stringValue
        }
        if let passphraseID=context["sshPassphraseId"], !passphraseID.isEmpty {
            guard let passphrase=allowed.first(where:{$0.id==passphraseID}) else {throw failure("Reconnect the SSH key passphrase in Credentials.")}
            values["sshPassphrase"]=try keychain.read(passphrase)
        }
        values["password"] = try keychain.read(credential)
        return values
    }
    private func failure(_ message:String) -> NSError { NSError(domain:"TaskCredentials",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
}
