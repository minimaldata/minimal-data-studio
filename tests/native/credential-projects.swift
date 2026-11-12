let suite = "mds-test-" + UUID().uuidString
let defaults = UserDefaults(suiteName:suite)!
defer { defaults.removePersistentDomain(forName:suite) }
let root = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
defer { try? FileManager.default.removeItem(at:root) }
let first=root.appendingPathComponent("First"), second=root.appendingPathComponent("Second")
try FileManager.default.createDirectory(at:first,withIntermediateDirectories:true)
try FileManager.default.createDirectory(at:second,withIntermediateDirectories:true)
let links=CredentialProjects(defaults:defaults)
try links.connect("key-one",to:first.path)
try links.connect("key-one",to:second.path)
try links.connect("key-one",to:first.path)
assert(links.paths(for:"key-one").count == 2)
assert(CredentialProjects(defaults:defaults).connected("key-one",to:first.path))
let copy=root.appendingPathComponent("Copy")
try FileManager.default.copyItem(at:first,to:copy)
assert(!links.connected("key-one",to:copy.path))
links.disconnect("key-one",from:first.path)
assert(!links.connected("key-one",to:first.path));assert(links.connected("key-one",to:second.path))
links.remove("key-one");assert(links.paths(for:"key-one").isEmpty)
do { try links.connect("key-one",to:root.appendingPathComponent("Missing").path);fatalError("Accepted missing path") } catch {}
print("Credential association checks passed")
