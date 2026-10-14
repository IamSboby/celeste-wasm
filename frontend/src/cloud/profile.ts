const KEY = "webleste-cloud-profile";
export const profileId = localStorage.getItem(KEY) || "local";
if (!/^[a-zA-Z0-9-]+$/.test(profileId)) throw new Error("Invalid local profile");
localStorage.setItem(KEY, profileId);
export const profilePath = profileId === "local" ? "" : `.cloud-profiles/${profileId}`;
// Own the entire local replica for the page lifetime, including all WASM writers.
export const profileLease = new Promise<void>((resolve, reject) => {
  if (!navigator.locks) { reject(new Error("Web Locks required; use a current Chromium browser over HTTPS.")); return; }
  navigator.locks.request(`webleste:${profileId}`, {ifAvailable: true}, async lock => {
    if (!lock) {
      document.body.textContent = "This Celeste installation is open in another tab. Close it, then reload here.";
      reject(new Error("Installation already open")); return;
    }
    resolve();
    await new Promise(() => {});
  }).catch(reject);
});
export function selectProfile(account: string, folder: string) {
  const index: Record<string, string> = JSON.parse(localStorage.getItem("webleste-cloud-profiles") || "{}");
  const key = `${account}:${folder}`;
  index[key] ||= crypto.randomUUID();
  localStorage.setItem("webleste-cloud-profiles", JSON.stringify(index));
  localStorage.setItem(KEY, index[key]);
  localStorage.setItem(`webleste-binding:${index[key]}`, JSON.stringify({account, folder}));
  location.reload();
}
export const binding: {account: string; folder: string} | null = JSON.parse(localStorage.getItem(`webleste-binding:${profileId}`) || "null");
