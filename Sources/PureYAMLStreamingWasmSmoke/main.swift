import Foundation
import PureYAML
import PureYAMLStreaming

struct SmokeResult: Encodable {
    var ok: Bool
    var documentCount: Int
    var firstName: String?
    var lastName: String?
    var message: String
}

let yaml = Data(
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
    let parser = PureYAMLStreaming.Parser(chunkSize: 7)
    let documents = try parser.collectDocuments(data: yaml)
    let names = documents.compactMap { document in
        stringValue("name", in: document.value)
    }
    let ok = documents.count == 3
        && names.first == "browser-0"
        && names.last == "browser-2"
    let result = SmokeResult(
        ok: ok,
        documentCount: documents.count,
        firstName: names.first,
        lastName: names.last,
        message: ok ? "PureYAMLStreaming WASM smoke passed" : "PureYAMLStreaming WASM smoke failed",
    )
    print(try renderJSON(result))
    Foundation.exit(ok ? 0 : 1)
} catch {
    let result = SmokeResult(
        ok: false,
        documentCount: 0,
        firstName: nil,
        lastName: nil,
        message: String(describing: error),
    )
    print((try? renderJSON(result)) ?? #"{"ok":false,"message":"failed to render error"}"#)
    Foundation.exit(1)
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
