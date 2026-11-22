// Compile after CredentialProjects.swift, Credentials.swift and TaskCredentials.swift.
// Uses a unique Keychain service and preferences suite; removes its dummy value afterward.
final class ProjectListStack: NSStackView { override var isFlipped:Bool { true } }
let testID = UUID().uuidString
let testService = "com.minimaldata.studio.tests." + testID
let testDefaults = UserDefaults(suiteName:testService)!
let testKeychain = StudioKeychain(service:testService)
let testProjects = CredentialProjects(defaults:testDefaults)
let testRoot = FileManager.default.temporaryDirectory.appendingPathComponent("mds-native-credentials-" + testID)
try FileManager.default.createDirectory(at:testRoot.appendingPathComponent(".studio"),withIntermediateDirectories:true)
defer { try? FileManager.default.removeItem(at:testRoot);testDefaults.removePersistentDomain(forName:testService) }
try testKeychain.add(name:"DUMMY_TEST_ONLY",value:"not-a-real-password")
let testItem = try testKeychain.list().first!
defer { try? testKeychain.remove(testItem) }
try testProjects.connect(testItem.id,to:testRoot.path)
let testConnection:[String:String] = ["id":"test-connection","name":"Dummy","provider":"snowflake","authentication":"password_mfa","account":"org-account","user":"dummy","role":"READER","warehouse":"WH","database":"DB","credentialId":testItem.id,"mfaMethod":"push"]
let testState = try JSONSerialization.data(withJSONObject:["revision":1,"connections":[testConnection]])
try testState.write(to:testRoot.appendingPathComponent(".studio/connections.json"))
var testContext = testConnection;testContext["mfaCaching"] = "automatic";testContext["project"] = CredentialProjects.identity(testRoot.path)!
let testFingerprint = try JSONSerialization.data(withJSONObject:testContext,options:.sortedKeys)
let testGrant = "connectionCredentialGrant.v1." + SHA256.hash(data:testFingerprint).map {String(format:"%02x",$0)}.joined()
testDefaults.set(true,forKey:testGrant)
let testBridge = TaskCredentials(keychain:testKeychain,projects:testProjects,defaults:testDefaults)
func ask(_ connection:[String:Any], operation:String = "resolve-connection", allowPrompt:Bool = true) throws -> [String:Any] {
    let pipe = Pipe()
    let request = try JSONSerialization.data(withJSONObject:["requestID":"test","operation":operation,"connection":connection,"allowPrompt":allowPrompt])
    testBridge.respond(line:"MDS_TASK_CREDENTIALS:"+String(data:request,encoding:.utf8)!,project:testRoot.path,input:pipe.fileHandleForWriting)
    try pipe.fileHandleForWriting.close()
    return try JSONSerialization.jsonObject(with:pipe.fileHandleForReading.readDataToEndOfFile()) as! [String:Any]
}
let success = try ask(testConnection)
precondition((success["values"] as? [String:String])?["password"] == "not-a-real-password")
var changed=testConnection;changed["account"]="different-account"
let rejected = try ask(changed)
precondition(rejected["error"] != nil && rejected["values"] == nil)
testProjects.disconnect(testItem.id,from:testRoot.path)
let disconnected = try ask(testConnection)
precondition(disconnected["error"] != nil && disconnected["values"] == nil)
print("Native credential checks passed: private pipe, destination binding and project association.")

try testProjects.connect(testItem.id,to:testRoot.path)
let supabaseConnection:[String:Any] = ["id":"supabase-test","name":"Supabase dummy","provider":"postgres","preset":"supabase","host":"aws-0-us-east-1.pooler.supabase.com","port":5432,"database":"postgres","user":"reader.test","credentialId":testItem.id,"sslrootcert":""]
try JSONSerialization.data(withJSONObject:["revision":2,"connections":[supabaseConnection]]).write(to:testRoot.appendingPathComponent(".studio/connections.json"))
var supabaseContext = supabaseConnection.mapValues { String(describing:$0) }
supabaseContext["project"] = CredentialProjects.identity(testRoot.path)!
let supabaseFingerprint = try JSONSerialization.data(withJSONObject:supabaseContext,options:.sortedKeys)
let supabaseGrant = "connectionCredentialGrant.v1." + SHA256.hash(data:supabaseFingerprint).map {String(format:"%02x",$0)}.joined()
testDefaults.set(true,forKey:supabaseGrant)
let supabaseSuccess = try ask(supabaseConnection)
precondition((supabaseSuccess["values"] as? [String:String])?["password"] == "not-a-real-password")
for field in ["host","user","database","sslrootcert"] {
    var changed = supabaseConnection;changed[field] = "different"
    let rejected = try ask(changed)
    precondition(rejected["error"] != nil && rejected["values"] == nil)
}
var wrongPort = supabaseConnection;wrongPort["port"] = 6543
let portRejected = try ask(wrongPort)
precondition(portRejected["error"] != nil && portRejected["values"] == nil)
print("Supabase credential checks passed: destination, CA and port binding.")

// Shared settings are resolved from the local registry, never supplied by the browser.
let centralRoot=testRoot.appendingPathComponent("central")
try FileManager.default.createDirectory(at:centralRoot,withIntermediateDirectories:true)
setenv("MDS_CONNECTIONS_DIR",centralRoot.path,1)
let sharedID="shared-dummy"
var shared=supabaseConnection;shared["id"]=sharedID
try JSONSerialization.data(withJSONObject:["connections":[shared]]).write(to:centralRoot.appendingPathComponent("connections.json"))
try JSONSerialization.data(withJSONObject:["format":2,"revision":3,"connections":[["id":"supabase-test","connectionId":sharedID,"name":"Supabase test","provider":"postgres"]]]).write(to:testRoot.appendingPathComponent(".studio/connections.json"))
testProjects.disconnect(testItem.id,from:testRoot.path)
let sharedSuccess=try ask(supabaseConnection)
precondition((sharedSuccess["values"] as? [String:String])?["password"] == "not-a-real-password")
var redirected=supabaseConnection;redirected["host"]="other.pooler.supabase.com"
let redirectedResult=try ask(redirected);precondition(redirectedResult["error"] != nil)
var centralContext=shared.mapValues {String(describing:$0)};centralContext["project"]="central-connection-test"
let centralFingerprint=try JSONSerialization.data(withJSONObject:centralContext,options:.sortedKeys)
let centralGrant="connectionCredentialGrant.v1." + SHA256.hash(data:centralFingerprint).map {String(format:"%02x",$0)}.joined()
testDefaults.set(true,forKey:centralGrant)
let centralSuccess=try ask(shared,operation:"resolve-central-connection")
precondition((centralSuccess["values"] as? [String:String])?["password"] == "not-a-real-password")
var centralRedirect=shared;centralRedirect["host"]="other.pooler.supabase.com"
let centralRejected=try ask(centralRedirect,operation:"resolve-central-connection");precondition(centralRejected["error"] != nil)
print("Central tests preserve destination binding without attaching to a project.")
try JSONSerialization.data(withJSONObject:["connections":[]]).write(to:centralRoot.appendingPathComponent("connections.json"))
let missingResult=try ask(supabaseConnection);precondition(missingResult["error"] != nil)
print("Shared connection checks passed: local registry binding and missing-link rejection.")

// SSH destination/key/passphrase bindings and pinned host identity, no real SSH login.
var tunneled:[String:Any]=["id":"ssh-test","name":"SSH test","provider":"postgres","preset":"direct","host":"db.example.com","port":5432,"user":"reader","database":"db","credentialId":testItem.id,"sslrootcert":"","sshHost":"jump.example.com","sshPort":22,"sshUser":"ec2-user","sshKeyPath":"/tmp/dummy-key","sshPassphraseId":testItem.id]
try testProjects.connect(testItem.id,to:testRoot.path)
try JSONSerialization.data(withJSONObject:["revision":4,"connections":[tunneled]]).write(to:testRoot.appendingPathComponent(".studio/connections.json"))
var sshContext=tunneled.mapValues {String(describing:$0)};sshContext["project"]=CredentialProjects.identity(testRoot.path)!
let sshGrantData=try JSONSerialization.data(withJSONObject:sshContext,options:.sortedKeys)
testDefaults.set(true,forKey:"connectionCredentialGrant.v1."+SHA256.hash(data:sshGrantData).map{String(format:"%02x",$0)}.joined())
let hostPin="sshServerPin.v1."+SHA256.hash(data:Data("jump.example.com:22".utf8)).map{String(format:"%02x",$0)}.joined()
let serverFingerprint="SHA256:"+String(repeating:"A",count:43)
testDefaults.set(serverFingerprint,forKey:hostPin)
tunneled["sshServerFingerprint"]=serverFingerprint
let sshSuccess=try ask(tunneled)
precondition((sshSuccess["values"] as? [String:String])?["sshPassphrase"]=="not-a-real-password")
for field in ["sshHost","sshUser","sshKeyPath","sshPassphraseId","sshServerFingerprint"] {
    var altered=tunneled;altered[field]=field=="sshServerFingerprint" ? "SHA256:"+String(repeating:"B",count:43) : "changed"
    let result=try ask(altered);precondition(result["error"] != nil && result["values"] == nil)
}
var portChange=tunneled;portChange["sshPort"]=2222
let sshPortRejected=try ask(portChange);precondition(sshPortRejected["error"] != nil)
print("SSH credential checks passed: fingerprint pinning, destination, port, key and passphrase binding.")

// Unsaved settings never reuse a persisted credential grant or bypass native approval.
var draft=testConnection;draft["id"]=String(repeating:"d",count:32)
var draftContext=draft;draftContext["mfaCaching"]="automatic";draftContext["project"]="unsaved-connection-test"
let draftFingerprint=try JSONSerialization.data(withJSONObject:draftContext,options:.sortedKeys)
testDefaults.set(true,forKey:"connectionCredentialGrant.v1."+SHA256.hash(data:draftFingerprint).map{String(format:"%02x",$0)}.joined())
let unapprovedDraft=try ask(draft,operation:"resolve-draft-connection",allowPrompt:false)
precondition((unapprovedDraft["error"] as? String)?.contains("requires native approval") == true && unapprovedDraft["values"] == nil)
draft["host"]="bad\nmetadata"
let invalidDraft=try ask(draft,operation:"resolve-draft-connection",allowPrompt:false)
precondition(invalidDraft["error"] != nil && invalidDraft["values"] == nil)
print("Unsaved connection tests require one-time native approval.")
