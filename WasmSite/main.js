import {
  ConsoleStdout,
  File,
  OpenFile,
  WASI,
} from "https://esm.sh/@bjorn3/browser_wasi_shim@0.3.0";

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

  let stdoutText = "";
  let stderrText = "";
  const fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered((line) => {
      stdoutText += `${line}\n`;
    }),
    ConsoleStdout.lineBuffered((line) => {
      stderrText += `${line}\n`;
    }),
  ];
  const wasi = new WASI([], [], fds);
  const wasm = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(wasm, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  wasi.start(instance);

  const parsed = parseSmokeOutput(stdoutText);
  const ok = parsed?.ok === true;

  statusElement.className = ok ? "status pass" : "status fail";
  statusElement.textContent = ok ? "Passed" : "Failed";
  outputElement.textContent = [
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

