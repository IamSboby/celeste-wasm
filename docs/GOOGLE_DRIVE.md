# Optional Google Drive synchronization

This fork preserves Webleste's local-file and archive setup. Open **Google Drive
(optional)** on setup, or **Settings → Google Drive Sync**. Cloud installations
are separate OPFS profiles. **Return to local installation** restores the
original profile, without deleting either installation.

## Configure Google

1. Create a Google Cloud project and enable **Google Drive API**.
2. Configure Google Auth Platform branding, contact email and audience. For a
   personal deployment, keep the application in testing and add your account as
   a test user. Public distribution may require Google's verification.
3. Create an OAuth client of type **Web application**. Authorized JavaScript
   origins: `https://iamsboby.github.io` and (for development)
   `http://localhost:5000`, `http://127.0.0.1:5000`. Origins have no path.
4. Copy only the public client ID to `.env` (see `.env.example`) or the GitHub
   Actions repository variable `VITE_GOOGLE_CLIENT_ID`, then rebuild.
   Do not publish a client secret, downloaded credential JSON, or user tokens.
5. Enable the `https://www.googleapis.com/auth/drive` scope in the consent
   configuration. The application uses GIS's browser token model. Tokens remain
   in memory; expiration prompts reconnection and keeps pending data locally.

`drive.file` authorizes individual app-created/opened files, not a recursive
grant to arbitrary pre-existing folder contents. This application must traverse
an existing installation, so it requests the restricted `drive` scope. The
folder browser uses the official Drive REST API; no Picker API key is required.
The scope permits more than the chosen folder, but application operations stay
within the selected folder and its journal. Never select an untrusted folder.

GIS runs in `drive-auth.html`, with `COOP: same-origin-allow-popups` and
`COEP: unsafe-none`. It returns the token over a random, same-origin
BroadcastChannel. The WASM page keeps `COOP: same-origin` / `COEP: require-corp`.
Google traffic uses native fetch, never the existing Wisp proxy.

References: [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

## Files and architecture

Select the root of your **FNA** Celeste installation, containing `Content` and
`Celeste.exe`, `orig/Celeste.exe`, or a supported `Celeste.dll`. All eight upstream
Content subdirectories must contain files. No commercial files are included.
`orig/Celeste.exe` is preferred as the patch input, as in upstream.

- The original local profile uses OPFS root. Cloud profiles use
  `.cloud-profiles/<uuid>`, keyed by verified Google account and folder ID.
- `Content/*` retains its path. Remote `Saves/*`, `Mods/*`, `Everest/*` map to
  runtime `Celeste/Saves/*`, `Celeste/Mods/*`, `Celeste/Everest/*` and back.
- The native OPFS backend mounts the selected profile at `/libsdl`; existing
  content/save symlinks, engine, renderer and MonoMod patcher are retained.
- `CustomCeleste.dll`, marker files, downloaded Everest installer and mod cache
  are generated locally. They are excluded from synchronization.
- `auth.ts` handles GIS; `drive.ts` handles official API calls; `local.ts`
  handles OPFS and incremental hashes; `model.ts` defines manifests and revision
  graphs; `engine.ts` reconciles, queues and resolves conflicts; `sync.worker.ts`
  runs hashing and transfers away from rendering; `ui.tsx` exposes state/settings.
- File identity includes Drive ID/version/size/checksum and a SHA-256 baseline.
  Duplicate names, shortcuts, unsupported Google documents and unsafe paths
  fail closed. Folder structure is preserved, with the runtime mapping above.

## Integrity and conflict policy

The original installation files are **never overwritten by automatic uploads**.
Updates are immutable blobs and small JSON commit records in
`.webleste-sync-v1` inside the selected Drive folder. Other Cloud Edition devices
apply this journal over the installation. This avoids depending on an atomic
compare-and-swap operation that Drive's file update interface does not provide.
Each commit lists its parents. Two devices publishing from the same parent
produce two heads; both survive, and the UI reports a conflict. External changes
to the original installation are separate heads as well. Explicit resolution
publishes a merge record. Previous blobs and local backups remain recoverable.

This means desktop Celeste will not automatically see the journal's saves.
To use a cloud save on desktop, export it through Webleste's file browser. Do not
delete `.webleste-sync-v1` unless you have independently backed up all versions.
Automatic journal/backup garbage collection is deliberately not implemented.

The durable queue is stored in `.cloud/state.json` alongside immutable OPFS
snapshots in `.cloud/pending`. Upload IDs are allocated and persisted before
publishing, so retries after lost responses reuse the same blob/commit IDs.
Uploads use 4 MiB chunks and resume by querying the session's committed offset.
Downloads checkpoint staging files every 4 MiB and use Range requests on retry.
Checksums and sizes are verified before a writable stream atomically replaces
the local destination. Existing files are backed up first. Quota errors retain
local data and queue entries. Partially completed installations cannot launch.

Polling starts at 20 seconds and backs off to 60 seconds after an error. Save
files receive the same immutable snapshot protection as mods and configurations.
Unchanged files are not uploaded. A lifetime Web Lock excludes a second tab for
the same replica. A small Emscripten pre-JS observer reports open OPFS handles
and an epoch over BroadcastChannel. During gameplay, snapshots are accepted
only if no handle was open and no handle transition occurred across hashing and
copying. If monitoring is unavailable, synchronization fails closed and retries.
It does not take competing file locks or make the game's writes depend on HTTP.
File metadata settling and rehashing also guard browser-side edits.

Remote downloads are deferred once WASMFS is mounted, because its directory
cache cannot safely observe arbitrary external changes. Reload before applying
remote updates. Changes remain queued when offline, after disconnect, or after
token expiry. `blur`/visibility events are best-effort triggers; correctness does
not depend on unload network requests. Abrupt shutdown before a scan is recovered
by comparing local files with the persisted baseline at the next startup.

## Build and deploy

Frontend: `npm ci`, `npm test`, `npm run test:browser`, `npm run build`.
Browser tests use Edge locally, Chromium in CI. They exercise real OPFS with
mock remote storage; they contain synthetic data, not game files.

The complete runtime requires Linux/WSL, Node 22, pnpm 10, .NET 10 (the upstream
README's .NET 9 reference is stale), Mono and the native dependencies fetched by
the upstream Makefile. Set `NUGET_PACKAGES` to `<repo>/nuget`, run
`dotnet workload restore loader`, then `make publish`.

The `pages.yml` workflow tests, builds the runtime and deploys `frontend/dist`
with GitHub Pages Actions. Configure Pages source as **GitHub Actions**. The
upstream Cloudflare workflow remains separate and is not used by the feature
branch. No commercial installation files enter the build or Pages artifact.

GitHub Pages does not provide custom response headers. The included service
worker supplies isolation headers and precaches the application and runtime.
The first visit waits for the complete offline shell, then reloads. Installation
fails on missing assets instead of claiming offline readiness. Asset versions
use a content-derived cache name. Older caches are retained to avoid breaking
already-open sessions. Browser settings may still evict storage; request
persistent storage where supported and keep Drive/backups as the durable copy.

## Validation and known limits

Automated coverage: manifest paths, revision forks/merges, request boundaries,
pagination, initial/incremental sync, real OPFS queue recovery, multi-device
updates/conflicts, new mods/deletions, failed commit recovery, large chunked
uploads, account isolation and offline integrity validation.

Real-account OAuth consent, Drive quota behavior, actual game launch, save/exit,
Everest mods and an actual offline game session require a configured OAuth client,
the user's licensed installation and the compiled runtime. A passing frontend
build or mocked test does not verify those scenarios.

The journal currently lists commit metadata each cycle; very long histories can
increase API usage. Folder shortcuts and Google-native documents are rejected.
The safe default is whole-file transfer of each changed file, not byte deltas.
Closed-file snapshots cannot establish semantic transaction boundaries across
arbitrary mod files; prior revisions are retained for recovery. Long-lived open
write handles defer that file's upload. Logs/caches that are excluded should be
regenerated. Offline launch needs a previously verified complete replica and a
complete cached shell. OAuth cannot be renewed without a user gesture.

## Troubleshooting

- **OAuth not configured / origin mismatch:** set the client ID, authorize the
  exact origin (no `/celeste-wasm` path), then rerun the Pages workflow.
- **Access denied:** add your account as a test user, enable Drive API, grant the
  requested scope and reconnect. Reconnecting does not delete local saves.
- **Popup blocked:** allow the helper window and press Continue with Google.
- **Conflict:** stop the game, reload, synchronize and choose Keep local or Use
  remote. When several remote heads exist, choose the desired blob in Drive,
  import it with the local file browser, then Keep local. All old versions stay.
- **Remote update deferred:** reload to rebuild the runtime's filesystem view.
- **Storage full:** export backups, free space in browser storage and retry.
  Do not clear site data while unsynchronized saves are pending.
- **Second tab:** close the first tab and reload. Account/folder switches retain
  separate profiles and require connecting the corresponding account.
- **Runtime initialization error:** check the workflow's full native build;
  frontend-only builds do not include `_framework` and cannot launch the game.

## Distribution

Upstream at `b4b19eb24a8499e4de96aee79f1272ffdb57281f` has no root LICENSE file.
This fork preserves attribution and does not invent a license for upstream code.
Third-party licenses remain applicable (including FNA, MonoMod, Emscripten,
Dreamland, and FMOD's separate licensing). Verify redistribution rights for
native binaries and artwork before broader distribution. Owning Celeste is
required; do not upload its commercial assets to GitHub or the Pages artifact.
