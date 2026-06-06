extension PureYAMLStreaming {
    /// Source position at a streaming boundary.
    public struct StreamingMark: Equatable, Sendable {
        public var line: Int
        public var column: Int
        public var index: Int

        public init(line: Int, column: Int, index: Int) {
            self.line = line
            self.column = column
            self.index = index
        }

        public static let start = StreamingMark(line: 1, column: 1, index: 0)
    }
}
