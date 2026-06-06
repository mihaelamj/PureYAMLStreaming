import Foundation
import PureYAML
import PureYAMLStreaming

struct SmokeResult: Encodable {
    var ok: Bool
    var inputByteCount: Int
    var documentCount: Int
    var firstName: String?
    var lastName: String?
    var parseMilliseconds: Double
    var message: String
}

let fallbackYAML = Data(
    """
    ---
    name: browser-0
    enabled: true
    nested:
      index: 0
    ---
    name: browser-1
    enabled: false
    nested:
      index: 1
    ---
    name: browser-2
    enabled: true
    nested:
      index: 2
    """.utf8,
)

do {
    let readsStandardInput = CommandLine.arguments.count > 1
    let input = readsStandardInput
        ? FileHandle.standardInput.readDataToEndOfFile()
        : Data()
    let yaml = readsStandardInput ? input : fallbackYAML
    let parser = PureYAMLStreaming.Parser(chunkSize: 31)
    let parseStart = Date()
    var documentCount = 0
    var firstName: String?
    var lastName: String?
    try parser.parseDocuments(data: yaml) { document in
        let name = stringValue("name", in: document.value)
        if documentCount == 0 {
            firstName = name
        }
        lastName = name
        documentCount += 1
    }
    let parseMilliseconds = Date().timeIntervalSince(parseStart) * 1_000
    let ok = documentCount > 0
    let result = SmokeResult(
        ok: ok,
        inputByteCount: yaml.count,
        documentCount: documentCount,
        firstName: firstName,
        lastName: lastName,
        parseMilliseconds: parseMilliseconds,
        message: ok ? "PureYAMLStreaming WASM parse passed" : "PureYAMLStreaming WASM parse found no documents",
    )
    print(try renderJSON(result))
} catch {
    let result = SmokeResult(
        ok: false,
        inputByteCount: 0,
        documentCount: 0,
        firstName: nil,
        lastName: nil,
        parseMilliseconds: 0,
        message: String(describing: error),
    )
    print((try? renderJSON(result)) ?? #"{"ok":false,"message":"failed to render error"}"#)
}

func stringValue(_ key: String, in value: PureYAML.Model.Value) -> String? {
    guard case let .mapping(mapping) = value,
          case let .string(string)? = mapping[key]
    else {
        return nil
    }
    return string
}

func renderJSON<Value: Encodable>(_ value: Value) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
}
