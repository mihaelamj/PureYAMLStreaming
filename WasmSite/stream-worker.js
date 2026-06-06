import {
  ConsoleStdout,
  File,
  OpenFile,
  WASI,
} from "./vendor/browser_wasi_shim/index.js";

const controlIndex = {
  read: 0,
  write: 1,
  available: 2,
  closed: 3,
  error: 4,
  sequence: 5,
  totalWritten: 6,
  readCalls: 7,
  waitCount: 8,
};

self.addEventListener("message", (event) => {
  if (event.data?.type !== "start") {
    return;
  }

  runStreamingBenchmark(event.data).catch((error) => {
    self.postMessage({
      type: "error",
      message: String(error?.stack || error),
    });
  });
});

async function runStreamingBenchmark(config) {
  const moduleLoadStart = performance.now();
  const module = await loadWasmModule(config.wasmURL);
  const moduleLoadMS = performance.now() - moduleLoadStart;
  self.postMessage({ type: "log", message: `Worker loaded WASM module in ${moduleLoadMS.toFixed(1)} ms.` });
  let stdoutText = "";
  let stderrText = "";
  const stdin = new StreamingStdin(config.sharedBuffer, config.capacity);
  const wasi = new WASI(
    ["pureyaml-streaming-wasm-smoke", "--stream-stdin", config.sourceURL, String(config.statusCode)],
    [],
    [
      stdin,
      ConsoleStdout.lineBuffered((line) => {
        stdoutText += `${line}\n`;
        self.postMessage({ type: "stdout", line });
      }),
      ConsoleStdout.lineBuffered((line) => {
        stderrText += `${line}\n`;
        self.postMessage({ type: "stderr", line });
      }),
    ],
  );

  self.postMessage({ type: "log", message: "Worker instantiated WASI runtime." });
  const processStart = performance.now();
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  self.postMessage({ type: "log", message: "Worker entering WASI _start with streaming stdin." });
  wasi.start(instance);
  const processWallClockMS = performance.now() - processStart;
  self.postMessage({
    type: "done",
    stdoutText,
    stderrText,
    moduleLoadMS,
    processWallClockMS,
    readCalls: Atomics.load(stdin.control, controlIndex.readCalls),
    waitCount: Atomics.load(stdin.control, controlIndex.waitCount),
  });
}

async function loadWasmModule(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM in worker: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  if (!url.endsWith(".gz")) {
    return WebAssembly.compile(bytes);
  }
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser does not support DecompressionStream in workers.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return WebAssembly.compile(await new Response(stream).arrayBuffer());
}

class StreamingStdin extends OpenFile {
  constructor(sharedBuffer, capacity) {
    super(new File([]));
    this.control = new Int32Array(sharedBuffer, 0, 16);
    this.bytes = new Uint8Array(sharedBuffer, 16 * Int32Array.BYTES_PER_ELEMENT, capacity);
    this.capacity = capacity;
  }

  fd_read(length) {
    const data = this.readBlocking(length);
    return { ret: 0, data };
  }

  readBlocking(length) {
    while (Atomics.load(this.control, controlIndex.available) === 0) {
      if (Atomics.load(this.control, controlIndex.closed) === 1 || Atomics.load(this.control, controlIndex.error) === 1) {
        return new Uint8Array();
      }
      Atomics.add(this.control, controlIndex.waitCount, 1);
      const sequence = Atomics.load(this.control, controlIndex.sequence);
      Atomics.wait(this.control, controlIndex.sequence, sequence);
    }

    const available = Atomics.load(this.control, controlIndex.available);
    const read = Atomics.load(this.control, controlIndex.read);
    const byteCount = Math.min(length, available, this.capacity - read);
    const result = this.bytes.slice(read, read + byteCount);
    Atomics.store(this.control, controlIndex.read, (read + byteCount) % this.capacity);
    Atomics.sub(this.control, controlIndex.available, byteCount);
    Atomics.add(this.control, controlIndex.readCalls, 1);
    Atomics.add(this.control, controlIndex.sequence, 1);
    Atomics.notify(this.control, controlIndex.sequence);
    return result;
  }
}
