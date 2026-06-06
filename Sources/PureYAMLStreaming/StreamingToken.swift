extension PureYAMLStreaming {
    /// Tokens emitted by the current streaming scanner milestone.
    public enum StreamingToken: Equatable, Sendable {
        case documentSource(String)
    }
}
