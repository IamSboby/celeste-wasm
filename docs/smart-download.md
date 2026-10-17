# Smart Download — partial implementation

Branch: feature/smart-download, based on cf8dc9c. **Room streaming is not implemented.** This branch has not changed the deployed site.

## Audit

| Problem | Code | Status |
|---|---|---|
| Shell waits for all framework files | prepare-offline.mjs, cloud-sw.js | Framework files now load on demand. |
| Uncached WASM chunk mistaken for EOF | cloud-sw.js fetch | Manifest separates known lazy files from nonexistent sentinel. |
| Wrong/truncated build resource | cloud-sw.js acquire | SHA-256 and size checked before atomic cache publication. |
| Duplicate/concurrent downloads | SW cache misses; SyncEngine batch | Deduplicated SW transfers and bounded priority scheduler in Drive. |
| Misleading 0/0 | cloud/ui.tsx | Unknown total displays discovery text, without progress bar. |
| Full content required at mount | SyncEngine.validateOffline/prepareSource | Still required; late native reads are not implemented. |
| External OPFS additions invisible to mounted tree | Emscripten.c and SyncEngine.mounted guard | Guard preserved pending native proof. |
| Eviction resembles user deletion | SyncEngine.scan | No content eviction; saves/mods/journal remain intact. |

## Implemented behavior

npm run build generates runtime-manifest.json: schema 1, sorted file paths, byte sizes and SHA-256. Cache identity includes the serialized manifest. Run make publish first for a complete native build. Files in _framework are excluded from shell installation and fetched on demand as complete files/chunks. The manifest describes published runtime files, **not room dependencies or the user's installation**.

The SW shares concurrent transfers, retries failures up to three attempts, verifies before Cache.put, and preserves arrayBuffer buffering for large WASM chunks. Current-manifest requests cannot silently receive older versions at the same URL. Unknown old build resources remain accessible from retained caches. Known missing chunks fail as downloads; only unknown numbered chunks return EOF 404 offline.

Settings provides an explicit complete-runtime offline download. Success means all published runtime resources were cached, not that Celeste content is installed. Game offline play still requires local installation or complete Drive synchronization. No cache eviction is introduced.

DownloadScheduler is integrated with Drive's existing worker. It supports P0–P3, promotion, stable ordering, in-flight deduplication and bounded concurrency. Save-Data/2G cap concurrency at 1, 3G/downlink below 2 Mbps at 2, otherwise the existing default 3 (maximum 6). These are conservative caps, not measured optimal settings. **All actual Drive jobs remain P0** until verified room dependencies exist. Existing resumable staging, integrity checks, retries, atomic OPFS publication and replica isolation are preserved.

## Primary-source evidence

- Everest commit 322fb9e19d890564b997657fe362d8d44b1f338d: Celeste.Mod.mm/Patches/Level.cs exposes TransitionTo and LoadLevel events after the original operations. They are not pre-read barriers and do not cover vanilla by themselves.
- Same revision, Patches/Audio.cs initializes shared Master Bank, music, sfx, ui and DLC banks. Room ownership cannot be inferred from filenames.
- Emscripten fb115aaf22510f106560d6698a2c1874c16b8487, system/lib/wasmfs/backends/fetch_backend.cpp uses MemoryDirectory with inserted data files. Its two-argument backend API differs from this repository's one-argument bundled API. Modern upstream chunk/range support cannot be assumed in the shipping binary.
- CelesteBootstrap.cs/Emscripten.c already insert fetch-backed DLL placeholders. A possible content strategy is a separately mounted read-only backend with its namespace declared before mounting and a validated byte broker. This requires proof with the bundled SDK; it is not implemented.

The authorized Drive folder was inspected read-only on 2026-10-16: Celeste.exe (UI rounded 2.5 MB), Content, Saves and Backups were visible. This does not establish FNA compatibility, completeness or dependencies. Executable download yielded no verified local file before browser control disconnected. No commercial files were published or committed.

## Tests and measurements

Run npm test, npm run test:browser and npm run build. Browser tests use real Service Worker/Cache Storage with a synthetic 20 MiB chunk, and real OPFS with mocked Drive.

Measured in the synthetic fixture: zero framework-chunk bytes before shell installation completes; two concurrent reads produce exactly one network transfer; both return 20 MiB. Subsequent offline read and EOF 404 pass. Explicit complete-runtime download also populates the lazy file before going offline. Unit tests cover corruption, truncation, retry, previous-cache access, OAuth helper headers, priorities, deduplication and concurrency limits.

This is not a gameplay benchmark. The previous full precache requirement was established by code inspection, not a comparable real-game timing run. Local frontend builds lack native _framework files; their byte totals do not represent the published runtime.

| Required gameplay metric | Result |
|---|---|
| Play to first playable frame | Not measured |
| Game-content bytes before Play | Still full replica |
| Transition latency/stalls | Not measured |
| Peak game cache/redownloads | Not measured; eviction disabled |

## Remaining acceptance work

1. Obtain the legitimate installation privately and verify FNA/runtime compatibility.
2. Inspect maps, atlases, audio and actual reads; generate an installation-fingerprinted dependency manifest with explicit unknown coverage.
3. Implement real vanilla/Everest session/room/respawn hooks and pre-transition barriers.
4. Prove late reads through the bundled native backend, with immutable versions, failure recovery and safe visibility.
5. Connect a verified non-linear graph to two-transition prefetch and the scheduler.
6. Separate reconstructible content from sync baselines before reference tracking, retention, budget or eviction.
7. Validate local/Drive sources, backtracking, checkpoints, mods, partial/full offline and benchmarks on the same installation.

The requested playable room before 100% installation and room prefetch are **not implemented or verified**. Do not label this branch completed Smart Download.

## Actual installation audit — 2026-10-17

The user's Drive installation became readable through its local mounted filesystem. Static ECMA-335 metadata inspection found references to Microsoft.Xna.Framework, Microsoft.Xna.Framework.Game and Microsoft.Xna.Framework.Graphics, rather than FNA. This is an XNA installation; the port documents and builds against FNA. A compatible installation is needed for representative gameplay validation. No executable was run during inspection.

Read-only inventory: 1,211 Content files, 1,158,620,133 bytes; seven FMOD bank files total 665,721,576 bytes. The largest are music.bank (393,143,808 bytes) and sfx.bank (164,503,840 bytes). Actual GFX loading also uses a shared Gameplay atlas. These are file sizes, not measured downloaded bytes or a room dependency map. Private inspection artifacts remain outside Git; no commercial code or assets are included in this PR.

Reproduce with PowerShell 7:

```powershell
./scripts/inspect-installation.ps1 -Installation '/path/to/your/Celeste' -Output '/private/path/inventory.json'
./tests/inspect-installation.test.ps1
```

The output records assembly references/hash, framework compatibility, Content paths/sizes and explicit dependency coverage. Add -HashContent to read and hash all content and generate a content fingerprint; on a cloud-mounted drive this hydrates the entire installation. The default metadata-only report deliberately has no content fingerprint and cannot certify byte integrity. Existing reports are never overwritten. Saves are excluded.

The inspector tests cover size accounting, unknown-framework rejection, save exclusion, changed-content fingerprint invalidation, metadata-only coverage and preservation of earlier reports. The Smart Download workflow runs frontend, browser and inspector checks without deploying or uploading any user installation.
