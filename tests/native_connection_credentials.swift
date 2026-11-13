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
func ask(_ connection:[String:String]) throws -> [String:Any] {
    let pipe = Pipe()
    let request = try JSONSerialization.data(withJSONObject:["requestID":"test","operation":"resolve-connection","connection":connection])
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
