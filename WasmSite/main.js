import {
  ConsoleStdout,
  File,
  OpenFile,
  WASI,
} from "https://esm.sh/@bjorn3/browser_wasi_shim@0.3.0";

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
    name: "GitHub REST API OpenAPI (9.5 MB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/github-rest-api.yaml",
  },
  {
    name: "Zoom OpenAPI (5.0 MB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/api-guru-zoom-openapi.yaml",
  },
  {
    name: "Stripe OpenAPI (3.7 MB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/api-guru-stripe-openapi.yaml",
  },
  {
    name: "cert-manager Helm values (65 KB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/cert-manager-values.yaml",
  },
  {
    name: "cert-manager CRD (44 KB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/cert-manager-certificate-crd.yaml",
  },
  {
    name: "Kubernetes Prow presubmits (14 KB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/prow-cluster-api-presubmits.yaml",
  },
  {
    name: "Prometheus config (12 KB)",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/prometheus-conf-good.yml",
  },
  {
    name: "USPTO OpenAPI",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/openapi-uspto.yaml",
  },
  {
    name: "OpenAPI petstore expanded",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/openapi-petstore-expanded.yaml",
  },
  {
    name: "Bitnami Apache values",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/bitnami-apache-values.yaml",
  },
  {
    name: "GitHub Actions Swift format",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/github-actions-swift-format.yml",
  },
  {
    name: "Docker Compose Prometheus/Grafana",
    url: "https://raw.githubusercontent.com/mihaelamj/PureYAMLGeekbench/main/Fixtures/real-yaml/awesome-compose-prometheus-grafana-compose-yaml.yaml",
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
  const response = await fetch(cacheBustedURL(sourceURL), { cache: "no-store" });
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
  const parseMS = performance.now() - parseStart;

  const parsed = parseSmokeOutput(stdoutText);
  const ok = parsed?.ok === true;
  const throughput = yamlBytes.byteLength / (parseMS / 1000);

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
    `parse: ${formatDuration(parseMS)}`,
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

function cacheBustedURL(url) {
  const parsedURL = new URL(url, location.href);
  parsedURL.searchParams.set("_pureyaml_bench", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return parsedURL.href;
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
