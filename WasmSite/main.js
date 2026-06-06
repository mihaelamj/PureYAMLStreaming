import {
  ConsoleStdout,
  File,
  OpenFile,
  WASI,
} from "./vendor/browser_wasi_shim/index.js";

const runButton = document.querySelector("#runButton");
const streamButton = document.querySelector("#streamButton");
const sampleSelect = document.querySelector("#sampleSelect");
const urlInput = document.querySelector("#urlInput");
const statusElement = document.querySelector("#status");
const outputElement = document.querySelector("#output");
const runLogElement = document.querySelector("#runLog");
const copyRunLogButton = document.querySelector("#copyRunLogButton");
const streamDocumentElement = document.querySelector("#streamDocument");
const isolationMetric = document.querySelector("#isolationMetric");
const sabMetric = document.querySelector("#sabMetric");
const workerMetric = document.querySelector("#workerMetric");
const modeMetric = document.querySelector("#modeMetric");
const bytesMetric = document.querySelector("#bytesMetric");
const fetchMetric = document.querySelector("#fetchMetric");
const parseMetric = document.querySelector("#parseMetric");
const throughputMetric = document.querySelector("#throughputMetric");
const documentsMetric = document.querySelector("#documentsMetric");
const params = new URLSearchParams(location.search);
const wasmURL = params.get("wasm") || "./pureyaml-streaming-wasm-smoke.wasm.gz";
let modulePromise = null;
let runStartedAt = performance.now();
const streamControlIndex = {
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
const streamControlCount = 16;
const streamBufferCapacity = 1024 * 1024;
const documentRenderBudget = 64 * 1024;
let documentRenderQueue = [];
let documentRenderScheduled = false;
let documentRenderResolvers = [];

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

streamButton.addEventListener("click", () => {
  runStreamingBenchmark().catch((error) => {
    renderFailure(error);
  });
});

copyRunLogButton.addEventListener("click", () => {
  copyRunLog().catch((error) => {
    logStep(`Unable to copy run log: ${String(error?.message || error)}`, "error");
  });
});

sampleSelect.addEventListener("change", () => {
  urlInput.value = sampleSelect.value;
});

updateStreamingCapabilities();

async function runBenchmark() {
  const sourceURL = urlInput.value.trim();
  if (!sourceURL) {
    throw new Error("Choose or enter a YAML URL first.");
  }

  runButton.disabled = true;
  streamButton.disabled = true;
  statusElement.className = "status idle";
  statusElement.textContent = "Preparing...";
  outputElement.textContent = "";
  resetMetrics();
  resetLog();
  resetStreamDocument("Waiting for buffered YAML fetch to complete.");
  logStep("Queued benchmark run.");
  logStep(`Selected source: ${sourceURL}`);

  logStep(`Loading WASM module: ${wasmURL}`);
  const moduleLoadStart = performance.now();
  const module = await loadWasmModule(wasmURL);
  const moduleLoadMS = performance.now() - moduleLoadStart;
  logStep(`WASM module ready in ${formatDuration(moduleLoadMS)}.`);

  statusElement.textContent = "Fetching YAML...";
  logStep("Fetching YAML bytes in the browser. This fetch is buffered before WASI starts.");
  const fetchStart = performance.now();
  const response = await fetch(sourceURL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch YAML: HTTP ${response.status}`);
  }
  const yamlBytes = new Uint8Array(await response.arrayBuffer());
  const fetchMS = performance.now() - fetchStart;
  replaceStreamDocument(decodeYAMLBytes(yamlBytes));
  await waitForDocumentFlush();
  await nextPaint();
  logStep(`Fetched HTTP ${response.status}, ${formatBytes(yamlBytes.byteLength)} in ${formatDuration(fetchMS)}.`);
  logStep("Handing buffered response to SwiftWASIHTTPClient.HostHTTPClient through WASI stdin.");

  logStep("Preparing WASI file descriptors.");
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
  logStep("Creating WASI instance.");
  const wasi = new WASI(["pureyaml-streaming-wasm-smoke", sourceURL, String(response.status)], [], fds);
  statusElement.textContent = "Running Swift parser...";
  logStep("Starting Swift parser. The browser tab can pause while WebAssembly is executing.");
  await nextPaint();
  const parseStart = performance.now();
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  logStep("WebAssembly instance created; entering WASI _start.");
  await nextPaint();
  wasi.start(instance);
  const wallClockParseMS = performance.now() - parseStart;
  logStep(`WASI process returned in ${formatDuration(wallClockParseMS)}.`);

  logStep("Parsing Swift JSON result from stdout.");
  const parsed = parseSmokeOutput(stdoutText);
  const ok = parsed?.ok === true;
  if (!Number.isFinite(parsed?.parseMilliseconds)) {
    throw new Error("WASM output did not include a finite Swift parseMilliseconds value.");
  }
  const parseMS = parsed.parseMilliseconds;
  const throughput = parseMS > 0 ? yamlBytes.byteLength / (parseMS / 1000) : 0;
  if (!Number.isFinite(parsed?.chunkCount) || !Number.isFinite(parsed?.chunkSize)) {
    throw new Error("WASM output did not include finite Swift chunk instrumentation.");
  }
  logStep(`Swift transport: ${parsed.transport || "unknown"}; HTTP status: ${parsed.httpStatusCode ?? "n/a"}.`);
  logStep(`Swift parse reported ${formatDuration(parseMS)}.`);
  logStep(
    `Swift ChunkedUTF8Reader consumed ${parsed.chunkCount} chunk(s) at chunkSize ${formatBytes(parsed.chunkSize)}.`,
  );
  logStep(`Largest Swift chunk observed: ${formatBytes(parsed.maxChunkByteCount ?? 0)}.`);
  logStep(`Document scanner emitted ${parsed.scannerDocumentSourceCount ?? 0} document source(s).`);
  logStep(`Parsed ${parsed.documentCount ?? 0} document(s).`);
  logStep(`Throughput: ${formatBytes(throughput)}/s.`);

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
  logStep(ok ? "Benchmark completed successfully." : "Benchmark finished with parser failure.");
  resetButtons();
}

async function runStreamingBenchmark() {
  const sourceURL = urlInput.value.trim();
  if (!sourceURL) {
    throw new Error("Choose or enter a YAML URL first.");
  }
  if (!streamingSupported()) {
    throw new Error("True streaming mode requires cross-origin isolation, SharedArrayBuffer, Worker, and Atomics.wait.");
  }

  runButton.disabled = true;
  streamButton.disabled = true;
  statusElement.className = "status idle";
  statusElement.textContent = "Streaming...";
  outputElement.textContent = "";
  resetMetrics();
  resetLog();
  resetStreamDocument("Waiting for streaming YAML chunks.");
  logStep("Queued true browser-to-WASI streaming run.");
  logStep(`Selected source: ${sourceURL}`);

  const sharedBuffer = new SharedArrayBuffer(
    streamControlCount * Int32Array.BYTES_PER_ELEMENT + streamBufferCapacity,
  );
  const control = new Int32Array(sharedBuffer, 0, streamControlCount);
  const bytes = new Uint8Array(sharedBuffer, streamControlCount * Int32Array.BYTES_PER_ELEMENT, streamBufferCapacity);
  let worker = null;
  let stdoutText = "";
  let stderrText = "";
  let workerDone;
  const workerDonePromise = new Promise((resolve, reject) => {
    workerDone = { resolve, reject };
  });

  logStep("Starting Worker-owned WASI runtime.");
  const fetchStart = performance.now();
  const response = await fetch(sourceURL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch YAML: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("This browser did not expose a ReadableStream response body.");
  }

  worker = new Worker("./stream-worker.js", { type: "module" });
  worker.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "log") {
      logStep(message.message);
    } else if (message.type === "stdout") {
      stdoutText += `${message.line}\n`;
    } else if (message.type === "stderr") {
      stderrText += `${message.line}\n`;
    } else if (message.type === "done") {
      stdoutText = message.stdoutText;
      stderrText = message.stderrText;
      logStep(`Worker fd_read calls: ${message.readCalls}; ring-buffer waits: ${message.waitCount}.`);
      workerDone.resolve(message);
    } else if (message.type === "error") {
      workerDone.reject(new Error(message.message));
    }
  });

  worker.postMessage({
    type: "start",
    wasmURL,
    sourceURL,
    statusCode: response.status,
    sharedBuffer,
    capacity: streamBufferCapacity,
  });

  logStep(`Streaming HTTP ${response.status} response body into SharedArrayBuffer.`);
  const reader = response.body.getReader();
  const documentDecoder = new TextDecoder();
  let networkChunkCount = 0;
  let fetchedByteCount = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      networkChunkCount += 1;
      fetchedByteCount += value.byteLength;
      appendStreamDocumentChunk(documentDecoder.decode(value, { stream: true }));
      await writeToRingBuffer(value, control, bytes);
      logStep(`Network chunk ${networkChunkCount}: wrote ${formatBytes(value.byteLength)} to ring buffer.`);
    }
  } catch (error) {
    Atomics.store(control, streamControlIndex.error, 1);
    Atomics.store(control, streamControlIndex.closed, 1);
    wakeRingBuffer(control);
    worker?.terminate();
    throw error;
  }
  appendStreamDocumentChunk(documentDecoder.decode());
  await waitForDocumentFlush();
  Atomics.store(control, streamControlIndex.closed, 1);
  wakeRingBuffer(control);
  const fetchMS = performance.now() - fetchStart;
  logStep(`Network stream finished: ${networkChunkCount} chunk(s), ${formatBytes(fetchedByteCount)} in ${formatDuration(fetchMS)}.`);

  let workerResult;
  try {
    workerResult = await workerDonePromise;
  } catch (error) {
    worker?.terminate();
    throw error;
  }
  worker?.terminate();
  renderBenchmarkResult({
    sourceURL,
    moduleLoadMS: workerResult.moduleLoadMS,
    fetchMS,
    wallClockParseMS: workerResult.processWallClockMS,
    stdoutText,
    stderrText,
    inputByteCount: fetchedByteCount,
    workerResult,
    modeLabel: "true streaming",
  });
}

function renderBenchmarkResult({
  sourceURL,
  moduleLoadMS,
  fetchMS,
  wallClockParseMS,
  stdoutText,
  stderrText,
  inputByteCount,
  modeLabel,
}) {
  logStep("Parsing Swift JSON result from stdout.");
  const parsed = parseSmokeOutput(stdoutText);
  const ok = parsed?.ok === true;
  if (!Number.isFinite(parsed?.parseMilliseconds)) {
    throw new Error("WASM output did not include a finite Swift parseMilliseconds value.");
  }
  const parseMS = parsed.parseMilliseconds;
  const throughput = parseMS > 0 ? inputByteCount / (parseMS / 1000) : 0;
  if (!Number.isFinite(parsed?.chunkCount) || !Number.isFinite(parsed?.chunkSize)) {
    throw new Error("WASM output did not include finite Swift chunk instrumentation.");
  }
  logStep(`Swift transport: ${parsed.transport || "unknown"}; HTTP status: ${parsed.httpStatusCode ?? "n/a"}.`);
  logStep(`Swift parse reported ${formatDuration(parseMS)}.`);
  logStep(
    `Swift ChunkedUTF8Reader consumed ${parsed.chunkCount} chunk(s) at chunkSize ${formatBytes(parsed.chunkSize)}.`,
  );
  logStep(`Largest Swift chunk observed: ${formatBytes(parsed.maxChunkByteCount ?? 0)}.`);
  logStep(`Document scanner emitted ${parsed.scannerDocumentSourceCount ?? 0} document source(s).`);
  logStep(`Swift stdin read calls: ${parsed.stdinReadCount ?? "n/a"}; max stdin read: ${formatBytes(parsed.maxStdinReadByteCount ?? 0)}.`);
  logStep(`Parsed ${parsed.documentCount ?? 0} document(s).`);
  logStep(`Throughput: ${formatBytes(throughput)}/s.`);

  statusElement.className = ok ? "status pass" : "status fail";
  statusElement.textContent = ok ? "Passed" : "Failed";
  bytesMetric.textContent = formatBytes(inputByteCount);
  fetchMetric.textContent = formatDuration(fetchMS);
  parseMetric.textContent = formatDuration(parseMS);
  throughputMetric.textContent = `${formatBytes(throughput)}/s`;
  documentsMetric.textContent = parsed?.documentCount ?? "-";
  outputElement.textContent = [
    `url: ${sourceURL}`,
    `mode: ${modeLabel}`,
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
  logStep(ok ? "Benchmark completed successfully." : "Benchmark finished with parser failure.");
  resetButtons();
}

async function writeToRingBuffer(chunk, control, bytes) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const available = Atomics.load(control, streamControlIndex.available);
    if (available >= streamBufferCapacity) {
      logStep("Ring buffer full; fetch pump waiting for Worker fd_read to resume.", "muted");
      await waitForRingSpace(control);
      logStep("Ring buffer has capacity again; fetch pump resumed.", "muted");
      continue;
    }

    const write = Atomics.load(control, streamControlIndex.write);
    const space = streamBufferCapacity - available;
    const byteCount = Math.min(chunk.byteLength - offset, space, streamBufferCapacity - write);
    bytes.set(chunk.subarray(offset, offset + byteCount), write);
    Atomics.store(control, streamControlIndex.write, (write + byteCount) % streamBufferCapacity);
    Atomics.add(control, streamControlIndex.available, byteCount);
    Atomics.add(control, streamControlIndex.totalWritten, byteCount);
    offset += byteCount;
    wakeRingBuffer(control);
  }
}

async function waitForRingSpace(control) {
  while (Atomics.load(control, streamControlIndex.available) >= streamBufferCapacity) {
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
}

function wakeRingBuffer(control) {
  Atomics.add(control, streamControlIndex.sequence, 1);
  Atomics.notify(control, streamControlIndex.sequence);
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
  logStep(`Failed: ${String(error?.message || error)}`, "error");
  resetButtons();
}

function resetButtons() {
  runButton.disabled = false;
  streamButton.disabled = !streamingSupported();
}

function updateStreamingCapabilities() {
  const isolated = crossOriginIsolated === true;
  const hasSharedArrayBuffer = "SharedArrayBuffer" in globalThis;
  const hasWorker = "Worker" in globalThis;
  const hasAtomicsWait = typeof Atomics?.wait === "function";
  isolationMetric.textContent = isolated ? "yes" : "no";
  sabMetric.textContent = hasSharedArrayBuffer ? "yes" : "no";
  workerMetric.textContent = hasWorker && hasAtomicsWait ? "yes" : "no";
  modeMetric.textContent = streamingSupported() ? "streaming enabled" : "buffered fallback";
  resetButtons();
}

function streamingSupported() {
  return crossOriginIsolated === true
    && "SharedArrayBuffer" in globalThis
    && "Worker" in globalThis
    && typeof Atomics?.wait === "function";
}

function resetMetrics() {
  bytesMetric.textContent = "-";
  fetchMetric.textContent = "-";
  parseMetric.textContent = "-";
  throughputMetric.textContent = "-";
  documentsMetric.textContent = "-";
}

async function copyRunLog() {
  const text = runLogElement.innerText.trim();
  if (!text) {
    return;
  }
  try {
    if ("clipboard" in navigator && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      copyTextWithTextarea(text);
    }
  } catch {
    copyTextWithTextarea(text);
  }
  const previousLabel = copyRunLogButton.textContent;
  copyRunLogButton.textContent = "Copied";
  window.setTimeout(() => {
    copyRunLogButton.textContent = previousLabel;
  }, 1500);
}

function copyTextWithTextarea(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function resetStreamDocument(message) {
  documentRenderQueue = [];
  documentRenderResolvers.splice(0).forEach((resolve) => resolve());
  streamDocumentElement.replaceChildren(document.createTextNode(message));
  streamDocumentElement.scrollTop = 0;
}

function replaceStreamDocument(text) {
  documentRenderQueue = [];
  documentRenderResolvers.splice(0).forEach((resolve) => resolve());
  streamDocumentElement.replaceChildren();
  appendStreamDocumentChunk(text || "(empty document)");
  streamDocumentElement.scrollTop = 0;
}

function appendStreamDocumentChunk(text) {
  if (!text) {
    return;
  }
  if (streamDocumentElement.childNodes.length === 1 && streamDocumentElement.textContent.startsWith("Waiting for")) {
    streamDocumentElement.replaceChildren();
  }
  documentRenderQueue.push(text);
  scheduleDocumentFlush();
}

function decodeYAMLBytes(bytes) {
  return new TextDecoder().decode(bytes);
}

function scheduleDocumentFlush() {
  if (documentRenderScheduled) {
    return;
  }
  documentRenderScheduled = true;
  requestAnimationFrame(flushDocumentRenderQueue);
}

function flushDocumentRenderQueue() {
  documentRenderScheduled = false;
  let remainingBudget = documentRenderBudget;
  const fragment = document.createDocumentFragment();

  while (documentRenderQueue.length > 0 && remainingBudget > 0) {
    const next = documentRenderQueue.shift();
    const piece = next.length > remainingBudget ? next.slice(0, remainingBudget) : next;
    const rest = next.length > remainingBudget ? next.slice(remainingBudget) : "";
    fragment.append(renderYAMLSyntax(piece));
    remainingBudget -= piece.length;
    if (rest) {
      documentRenderQueue.unshift(rest);
    }
  }

  streamDocumentElement.append(fragment);
  streamDocumentElement.scrollTop = streamDocumentElement.scrollHeight;

  if (documentRenderQueue.length > 0) {
    scheduleDocumentFlush();
    return;
  }

  documentRenderResolvers.splice(0).forEach((resolve) => resolve());
}

function waitForDocumentFlush() {
  if (!documentRenderScheduled && documentRenderQueue.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    documentRenderResolvers.push(resolve);
  });
}

function renderYAMLSyntax(text) {
  const fragment = document.createDocumentFragment();
  for (const segment of text.split(/(\r?\n)/)) {
    if (segment === "\n" || segment === "\r\n") {
      fragment.append(document.createTextNode(segment));
    } else {
      renderYAMLLine(segment, fragment);
    }
  }
  return fragment;
}

function renderYAMLLine(line, fragment) {
  const commentIndex = findYAMLCommentIndex(line);
  const source = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const keyMatch = source.match(/^(\s*(?:-\s*)?)([A-Za-z0-9_.-]+)(\s*:)(.*)$/);
  if (source.trim() === "---" || source.trim() === "...") {
    appendSyntaxSpan(fragment, source, "yaml-marker");
  } else if (keyMatch) {
    fragment.append(document.createTextNode(keyMatch[1]));
    appendSyntaxSpan(fragment, keyMatch[2], "yaml-key");
    appendSyntaxSpan(fragment, keyMatch[3], "yaml-punctuation");
    appendYAMLValue(fragment, keyMatch[4]);
  } else {
    appendYAMLValue(fragment, source);
  }
  if (comment) {
    appendSyntaxSpan(fragment, comment, "yaml-comment");
  }
}

function appendYAMLValue(fragment, value) {
  const trimmed = value.trim();
  const leading = value.slice(0, value.length - value.trimStart().length);
  const trailingStart = value.length - value.trimEnd().length;
  const trailing = trailingStart > 0 ? value.slice(value.length - trailingStart) : "";
  if (leading) {
    fragment.append(document.createTextNode(leading));
  }
  if (/^(true|false|null|~)$/i.test(trimmed)) {
    appendSyntaxSpan(fragment, trimmed, "yaml-literal");
  } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    appendSyntaxSpan(fragment, trimmed, "yaml-number");
  } else if (/^(['"]).*\1$/.test(trimmed)) {
    appendSyntaxSpan(fragment, trimmed, "yaml-string");
  } else {
    fragment.append(document.createTextNode(trimmed));
  }
  if (trailing) {
    fragment.append(document.createTextNode(trailing));
  }
}

function appendSyntaxSpan(fragment, text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  fragment.append(span);
}

function findYAMLCommentIndex(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === "'" || character === "\"") && line[index - 1] !== "\\") {
      quote = quote === character ? null : quote || character;
    }
    if (character === "#" && quote === null && (index === 0 || /\s/.test(line[index - 1]))) {
      return index;
    }
  }
  return -1;
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

function resetLog() {
  runStartedAt = performance.now();
  runLogElement.replaceChildren();
}

function logStep(message, level = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  const elapsed = (performance.now() - runStartedAt) / 1000;
  entry.textContent = `[+${elapsed.toFixed(3)}s] ${message}`;
  runLogElement.append(entry);
  runLogElement.scrollTop = runLogElement.scrollHeight;
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}
