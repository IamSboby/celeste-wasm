"use strict";
const params = new URLSearchParams(location.hash.slice(1));
const nonce = params.get("nonce");
const clientId = params.get("clientId");
history.replaceState(null, "", location.pathname);
const channel = new BroadcastChannel(`webleste-auth:${nonce}`);
const statusEl = document.getElementById("status");
window.gisReady = () => {
  if (!nonce || !clientId) { statusEl.textContent = "Open this page from Celeste."; return; }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: "https://www.googleapis.com/auth/drive", include_granted_scopes: false,
    callback: response => {
      if (response.error) { statusEl.textContent = response.error; channel.postMessage({nonce, error: response.error}); return; }
      if (!google.accounts.oauth2.hasGrantedAllScopes(response, "https://www.googleapis.com/auth/drive")) {
        statusEl.textContent = "Drive permission is required."; return;
      }
      channel.postMessage({nonce, access_token: response.access_token, expires_in: response.expires_in});
      statusEl.textContent = "Connected. Return to Celeste. You can close this window.";
      document.getElementById("connect").disabled = true;
      setTimeout(() => { channel.close(); window.close(); }, 1000);
    },
    error_callback: error => { statusEl.textContent = error.type; channel.postMessage({nonce, error: error.type}); }
  });
  document.getElementById("connect").disabled = false;
  document.getElementById("connect").onclick = () => client.requestAccessToken({prompt: "select_account"});
  statusEl.textContent = "Ready to connect.";
};
if (window.google?.accounts) window.gisReady();
