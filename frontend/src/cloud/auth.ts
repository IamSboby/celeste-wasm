export class GoogleDriveAuth {
  private token = "";
  private expires = 0;
  get expiresAt() { return this.expires; }
  account = "";
  email = "";
  get connected() { return !!this.token && Date.now() < this.expires; }
  getToken = () => {
    if (!this.connected) throw new Error("Google session expired. Connect Google Drive again; local changes are safe.");
    return this.token;
  };
  disconnect() { this.token = ""; this.expires = 0; this.account = ""; this.email = ""; }
  connect(): Promise<void> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return Promise.reject(new Error("Set VITE_GOOGLE_CLIENT_ID in .env before building."));
    // The helper has COOP same-origin-allow-popups and COEP unsafe-none. Never
    // relax the WASM page's isolation. BroadcastChannel works across COOP groups.
    const nonce = crypto.randomUUID();
    const channel = new BroadcastChannel(`webleste-auth:${nonce}`);
    const url = new URL("drive-auth.html", location.href);
    url.hash = new URLSearchParams({nonce, clientId}).toString();
    const popup = window.open(url, "_blank", "popup,width=520,height=650");
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timeout); channel.close(); if (error) reject(error); else resolve(); };
      const timeout = setTimeout(() => finish(new Error("Google sign-in timed out or was cancelled.")), 180_000);
      if (!popup) { finish(new Error("Allow popups to connect Google Drive.")); return; }
      channel.onmessage = async ({data}) => {
        if (data.nonce !== nonce) return;
        if (data.error) { finish(new Error(data.error)); return; }
        if (!data.access_token || !Number.isFinite(Number(data.expires_in))) return;
        try {
          const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {headers: {Authorization: `Bearer ${data.access_token}`}, redirect: "error"});
          if (!response.ok) throw new Error(`Google account verification failed (${response.status})`);
          const {user} = await response.json();
          this.account = user.permissionId; this.email = user.emailAddress;
          this.token = data.access_token;
          this.expires = Date.now() + (Number(data.expires_in) - 60) * 1000;
          finish();
        } catch (e) { this.disconnect(); finish(e as Error); }
      };
    });
  }
}
