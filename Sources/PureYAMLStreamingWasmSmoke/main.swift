import Foundation
import PureYAML
import PureYAMLStreaming

struct SmokeResult: Encodable {
    var ok: Bool
    var inputByteCount: Int
    var documentCount: Int
    var firstName: String?
    var lastName: String?
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
    let input = CommandLine.arguments.count > 1
        ? FileHandle.standardInput.readDataToEndOfFile()
        : Data()
    let yaml = input.isEmpty ? fallbackYAML : input
    let parser = PureYAMLStreaming.Parser(chunkSize: 31)
    let documents = try parser.collectDocuments(data: yaml)
    let names = documents.compactMap { document in
        stringValue("name", in: document.value)
    }
    let ok = !documents.isEmpty
    let result = SmokeResult(
        ok: ok,
        inputByteCount: yaml.count,
        documentCount: documents.count,
        firstName: names.first,
        lastName: names.last,
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
