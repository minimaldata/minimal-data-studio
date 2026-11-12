import Foundation

/// Local associations only. No secrets, and no authorization to execute scripts.
final class CredentialProjects {
    private let defaults: UserDefaults
    private let storageKey = "credentialProjects.v1"
    init(defaults:UserDefaults = .standard) { self.defaults = defaults }
    static func identity(_ path:String) -> String? {
        let url = URL(fileURLWithPath:path).standardizedFileURL.resolvingSymlinksInPath()
        guard let info = try? FileManager.default.attributesOfItem(atPath:url.path),
              info[.type] as? FileAttributeType == .typeDirectory,
              let device = info[.systemNumber] as? NSNumber, let inode = info[.systemFileNumber] as? NSNumber else { return nil }
        return "\(device):\(inode):\(url.path)"
    }
    private var associations: [String:[String:String]] {
        get { defaults.dictionary(forKey:storageKey) as? [String:[String:String]] ?? [:] }
        set { defaults.set(newValue,forKey:storageKey) }
    }
    func paths(for credential:String) -> [String] { Array((associations[credential] ?? [:]).values).sorted() }
    func connected(_ credential:String, to path:String) -> Bool {
        guard let identity = Self.identity(path) else { return false }
        return associations[credential]?[identity] != nil
    }
    func connect(_ credential:String, to path:String) throws {
        guard let identity = Self.identity(path) else {
            throw NSError(domain:"CredentialProjects",code:1,userInfo:[NSLocalizedDescriptionKey:"Project folder is unavailable. Choose its current location first."])
        }
        var all = associations
        all[credential,default:[:]][identity] = URL(fileURLWithPath:path).standardizedFileURL.resolvingSymlinksInPath().path
        associations = all
    }
    func disconnect(_ credential:String, from path:String) {
        guard let identity = Self.identity(path) else { return }
        var all = associations; all[credential]?[identity] = nil; associations = all
    }
    func remove(_ credential:String) { var all = associations; all[credential] = nil; associations = all }
}
