(() => {
  const coop = "same-origin";
  const coep = "credentialless";

  if (typeof Window !== "undefined" && self instanceof Window) {
    if (window.crossOriginIsolated || !("serviceWorker" in navigator) || !window.isSecureContext) {
      return;
    }

    navigator.serviceWorker.register("./coi-serviceworker.js").then(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller && sessionStorage.getItem("coiReloaded") !== "1") {
        sessionStorage.setItem("coiReloaded", "1");
        window.location.reload();
      }
    }).catch((error) => {
      console.warn("Unable to register cross-origin isolation service worker", error);
    });
    return;
  }

  self.addEventListener("install", () => {
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
      return;
    }

    event.respondWith((async () => {
      const response = await fetch(event.request);
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", coop);
      headers.set("Cross-Origin-Embedder-Policy", coep);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })());
  });
})();
