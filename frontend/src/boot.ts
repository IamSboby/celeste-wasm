async function boot() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.register("./cloud-sw.js");
    if (!navigator.serviceWorker.controller) {
      document.getElementById("app")!.textContent = "Preparing offline runtime… This first download can take a few minutes.";
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange",()=>resolve(),{once:true}));
      location.reload(); return;
    }
    void registration.update();
  }
  if (!crossOriginIsolated) throw new Error("Cross-origin isolation is required. Enable service workers or configure COOP/COEP headers.");
  await import("./app");
}
boot().catch(error=>{document.getElementById("app")!.textContent = `Startup failed: ${error.message}. Check your connection and reload.`;});
