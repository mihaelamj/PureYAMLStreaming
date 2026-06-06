(() => {
  const coop = "same-origin";
  const coep = "credentialless";
  const reloadKey = "pureyamlStreamingCOIReloadedV2";

  if (typeof Window !== "undefined" && self instanceof Window) {
    if (window.crossOriginIsolated || !("serviceWorker" in navigator) || !window.isSecureContext) {
      return;
    }

    const reloadForIsolation = () => {
      if (!window.crossOriginIsolated && sessionStorage.getItem(reloadKey) !== "1") {
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", reloadForIsolation);

    navigator.serviceWorker.register("./coi-serviceworker.js").then(async (registration) => {
      await registration.update();
      await navigator.serviceWorker.ready;
      reloadForIsolation();
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
