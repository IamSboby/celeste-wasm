async function boot() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
      if (navigator.serviceWorker.controller || event.data?.type !== "offline-install") return;
      document.getElementById("app")!.textContent = event.data.error
        ? `Offline preparation failed: ${event.data.error}. Check your connection and reload.`
        : `Preparing offline runtime… ${event.data.completed}/${event.data.total} files downloaded.`;
    });
    const registration = await navigator.serviceWorker.register("./cloud-sw.js");
    if (!navigator.serviceWorker.controller) {
      document.getElementById("app")!.textContent = "Preparing offline runtime… This first download can take a few minutes.";
      await new Promise<void>((resolve, reject) => {
        const watch = () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "redundant") reject(new Error("Offline runtime installation failed"));
          });
          worker.postMessage({type:"offline-install-status"});
        };
        registration.addEventListener("updatefound", watch);
        watch();
        void navigator.serviceWorker.ready.then(() => { registration.removeEventListener("updatefound", watch); resolve(); });
      });
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange",()=>resolve(),{once:true}));
      location.reload(); return;
    }
    void registration.update();
  }
  if (!crossOriginIsolated) throw new Error("Cross-origin isolation is required. Enable service workers or configure COOP/COEP headers.");
  await import("./app");
}
boot().catch(error=>{document.getElementById("app")!.textContent = `Startup failed: ${error.message}. Check your connection and reload.`;});
