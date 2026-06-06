import {
  File,
  OpenFile,
  WASI,
} from "https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.1/+esm";

const runButton = document.querySelector("#runButton");
const statusElement = document.querySelector("#status");
const outputElement = document.querySelector("#output");
const params = new URLSearchParams(location.search);
const wasmURL = params.get("wasm") || "./pureyaml-streaming-wasm-smoke.wasm.gz";

runButton.addEventListener("click", () => {
  runSmokeTest().catch((error) => {
    renderFailure(error);
  });
});

async function runSmokeTest() {
  runButton.disabled = true;
  statusElement.className = "status idle";
  statusElement.textContent = "Running...";
  outputElement.textContent = "Loading WASM...";

  const wasmBytes = await loadWasmBytes(wasmURL);

  const stdout = new CapturingFile();
  const stderr = new CapturingFile();
  const fds = [
    new OpenFile(new File([])),
    new OpenFile(stdout),
    new OpenFile(stderr),
  ];
  const wasi = new WASI([], [], fds);
  const wasm = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(wasm, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  let exitCode = 0;
  try {
    wasi.start(instance);
  } catch (error) {
    if (typeof error?.code === "number") {
      exitCode = error.code;
    } else {
      throw error;
    }
  }

  const stdoutText = stdout.text();
  const stderrText = stderr.text();
  const parsed = parseSmokeOutput(stdoutText);
  const ok = exitCode === 0 && parsed?.ok === true;

  statusElement.className = ok ? "status pass" : "status fail";
  statusElement.textContent = ok ? "Passed" : "Failed";
  outputElement.textContent = [
    `exitCode: ${exitCode}`,
    "",
    "stdout:",
    stdoutText || "(empty)",
    "",
    "stderr:",
    stderrText || "(empty)",
  ].join("\n");
  runButton.disabled = false;
}

async function loadWasmBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  if (!url.endsWith(".gz")) {
    return bytes;
  }
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser does not support DecompressionStream.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function parseSmokeOutput(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function renderFailure(error) {
  statusElement.className = "status fail";
  statusElement.textContent = "Failed";
  outputElement.textContent = String(error?.stack || error);
  runButton.disabled = false;
}

class CapturingFile extends File {
  constructor() {
    super([]);
    this.bytes = [];
  }

  write(buffer) {
    this.bytes.push(...buffer);
    return { ret: buffer.length };
  }

  text() {
    return new TextDecoder().decode(new Uint8Array(this.bytes));
  }
}
