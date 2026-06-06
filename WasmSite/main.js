import {
  ConsoleStdout,
  File,
  OpenFile,
  WASI,
} from "./vendor/browser_wasi_shim/index.js";

const runButton = document.querySelector("#runButton");
const sampleSelect = document.querySelector("#sampleSelect");
const urlInput = document.querySelector("#urlInput");
const statusElement = document.querySelector("#status");
const outputElement = document.querySelector("#output");
const bytesMetric = document.querySelector("#bytesMetric");
const fetchMetric = document.querySelector("#fetchMetric");
const parseMetric = document.querySelector("#parseMetric");
const throughputMetric = document.querySelector("#throughputMetric");
const documentsMetric = document.querySelector("#documentsMetric");
const params = new URLSearchParams(location.search);
const wasmURL = params.get("wasm") || "./pureyaml-streaming-wasm-smoke.wasm.gz";
let modulePromise = null;

const samples = [
  {
    name: "GitHub REST API OpenAPI (8.39 MiB)",
    url: "https://api.apis.guru/v2/specs/github.com/1.1.4/openapi.yaml",
  },
  {
    name: "Loket.nl API OpenAPI (10.62 MiB)",
    url: "https://api.apis.guru/v2/specs/loket.nl/V2/openapi.yaml",
  },
  {
    name: "Zuora Billing API OpenAPI (6.46 MiB)",
    url: "https://api.apis.guru/v2/specs/zuora.com/2021-08-20/openapi.yaml",
  },
  {
    name: "Amazon EC2 OpenAPI (5.36 MiB)",
    url: "https://api.apis.guru/v2/specs/amazonaws.com/ec2/2016-11-15/openapi.yaml",
  },
  {
    name: "Zoom API OpenAPI (4.80 MiB)",
    url: "https://api.apis.guru/v2/specs/zoom.us/2.0.0/openapi.yaml",
  },
  {
    name: "UniCourt Enterprise APIs OpenAPI (4.29 MiB)",
    url: "https://api.apis.guru/v2/specs/unicourt.com/1.0.0/openapi.yaml",
  },
  {
    name: "Kubernetes Swagger (4.26 MiB)",
    url: "https://api.apis.guru/v2/specs/kubernetes.io/unversioned/swagger.yaml",
  },
  {
    name: "Autotask PSA Swagger (3.90 MiB)",
    url: "https://api.apis.guru/v2/specs/autotask.net/v1/swagger.yaml",
  },
  {
    name: "Google Document AI Warehouse OpenAPI (3.61 MiB)",
    url: "https://api.apis.guru/v2/specs/googleapis.com/contentwarehouse/v1/openapi.yaml",
  },
  {
    name: "Stripe API OpenAPI (3.48 MiB)",
    url: "https://api.apis.guru/v2/specs/stripe.com/2022-11-15/openapi.yaml",
  },
  {
    name: "Google Compute Engine OpenAPI (3.32 MiB)",
    url: "https://api.apis.guru/v2/specs/googleapis.com/compute/v1/openapi.yaml",
  },
  {
    name: "DocuSign REST API OpenAPI (3.14 MiB)",
    url: "https://api.apis.guru/v2/specs/docusign.net/v2.1/openapi.yaml",
  },
];

for (const sample of samples) {
  const option = document.createElement("option");
  option.value = sample.url;
  option.textContent = sample.name;
  sampleSelect.append(option);
}
urlInput.value = samples[0].url;

runButton.addEventListener("click", () => {
  runBenchmark().catch((error) => {
    renderFailure(error);
  });
});

sampleSelect.addEventListener("change", () => {
  urlInput.value = sampleSelect.value;
});

async function runBenchmark() {
  const sourceURL = urlInput.value.trim();
  if (!sourceURL) {
    throw new Error("Choose or enter a YAML URL first.");
  }

  runButton.disabled = true;
  statusElement.className = "status idle";
  statusElement.textContent = "Fetching YAML...";
  outputElement.textContent = "";
  resetMetrics();

  const moduleLoadStart = performance.now();
  const module = await loadWasmModule(wasmURL);
  const moduleLoadMS = performance.now() - moduleLoadStart;

  const fetchStart = performance.now();
  const response = await fetch(sourceURL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch YAML: HTTP ${response.status}`);
  }
  const yamlBytes = new Uint8Array(await response.arrayBuffer());
  const fetchMS = performance.now() - fetchStart;

  let stdoutText = "";
  let stderrText = "";
  const fds = [
    new OpenFile(new File(yamlBytes)),
    ConsoleStdout.lineBuffered((line) => {
      stdoutText += `${line}\n`;
    }),
    ConsoleStdout.lineBuffered((line) => {
      stderrText += `${line}\n`;
    }),
  ];
  const wasi = new WASI(["pureyaml-streaming-wasm-smoke", sourceURL], [], fds);
  statusElement.textContent = "Running Swift parser...";
  const parseStart = performance.now();
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.start(instance);
  const wallClockParseMS = performance.now() - parseStart;

  const parsed = parseSmokeOutput(stdoutText);
  const ok = parsed?.ok === true;
  if (!Number.isFinite(parsed?.parseMilliseconds)) {
    throw new Error("WASM output did not include a finite Swift parseMilliseconds value.");
  }
  const parseMS = parsed.parseMilliseconds;
  const throughput = parseMS > 0 ? yamlBytes.byteLength / (parseMS / 1000) : 0;

  statusElement.className = ok ? "status pass" : "status fail";
  statusElement.textContent = ok ? "Passed" : "Failed";
  bytesMetric.textContent = formatBytes(yamlBytes.byteLength);
  fetchMetric.textContent = formatDuration(fetchMS);
  parseMetric.textContent = formatDuration(parseMS);
  throughputMetric.textContent = `${formatBytes(throughput)}/s`;
  documentsMetric.textContent = parsed?.documentCount ?? "-";
  outputElement.textContent = [
    `url: ${sourceURL}`,
    `moduleLoad: ${formatDuration(moduleLoadMS)}`,
    `fetch: ${formatDuration(fetchMS)}`,
    `swiftParse: ${formatDuration(parseMS)}`,
    `processWallClock: ${formatDuration(wallClockParseMS)}`,
    `throughput: ${formatBytes(throughput)}/s`,
    "",
    "stdout:",
    stdoutText || "(empty)",
    "",
    "stderr:",
    stderrText || "(empty)",
  ].join("\n");
  runButton.disabled = false;
}

async function loadWasmModule(url) {
  if (!modulePromise) {
    modulePromise = loadWasmBytes(url).then((bytes) => WebAssembly.compile(bytes));
  }
  return modulePromise;
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

function resetMetrics() {
  bytesMetric.textContent = "-";
  fetchMetric.textContent = "-";
  parseMetric.textContent = "-";
  throughputMetric.textContent = "-";
  documentsMetric.textContent = "-";
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) {
    return `${milliseconds.toFixed(1)} ms`;
  }
  return `${(milliseconds / 1000).toFixed(3)} s`;
}

function formatBytes(byteCount) {
  if (byteCount < 1024) {
    return `${byteCount.toFixed(0)} B`;
  }
  if (byteCount < 1024 * 1024) {
    return `${(byteCount / 1024).toFixed(1)} KiB`;
  }
  return `${(byteCount / 1024 / 1024).toFixed(2)} MiB`;
}
