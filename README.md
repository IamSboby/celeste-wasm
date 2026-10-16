<img src="frontend/public/app.webp" width=100 align="left">

<h1>Webleste</h1>

This fork adds **optional Google Drive synchronization**, alongside the original
local installation and archive flows. Gameplay still runs entirely on OPFS.
See [setup, architecture, recovery, testing and deployment](docs/GOOGLE_DRIVE.md).

Upstream: [MercuryWorkshop/celeste-wasm](https://github.com/MercuryWorkshop/celeste-wasm),
based on `threads-v2`. Development branch: `feature/google-drive-sync`.

<br>

A mostly-complete port of Celeste (2018) to WebAssembly, with full support for Everest mods. Powered by [FNA-WASM-Build](https://github.com/r58playz/FNA-WASM-Build) and [MonoMod.WASM](https://github.com/r58Playz/MonoMod).

![Webleste demo image](assets/demo.png)
<sup><i>Strawberry Jam</i> running in Webleste</sup>

## Limitations

- Loading the game consumes 600M or so of memory, which is still around 3x lower than the original port, but it is still too much for low end devices.
- You may encounter issues on Firefox.

## I want to build this

1. Ensure node and pnpm exist and `pnpm i`
2. Install dotnet 9.0.4
3. Install the mono-devel package on your distro
4. Run `sudo dotnet workload restore` in `loader/`
5. Run `make serve` for a dev server and `make publish` for a release build

## I want to figure out how this works

- The native dotnet WASM support is used to compile a loader program to WASM
  - `loader/Celeste.cs` loads a patched Celeste assembly and exports a function that polls its main loop
  - `loader/Patcher.cs` runs MonoMod on celeste assemblies provided by the user to patch it for WASM
  - `patcher/` has the source for the `MonoMod.Patcher` mod used for WASM patches
- A WASM port of MonoMod is used to provide detours/hooks to Everest and other runtime mods, it functions completely on the IL level and is mono specific
- FMOD pthread builds are used for audio, with slight patching of the bindings so that using FMOD 2 works
- The game canvas is transferred to dotnet's "deputy thread" and all rendering is done from there through FNA's OpenGL driver

For a deeper dive into how we made this and [the Terraria web port](https://github.com/MercuryWorkshop/terraria-wasm), check out the [writeup](https://velzie.rip/blog/celeste-wasm).

## I want to port this to a newer version of Celeste (once it exists)

1. Fix any issues with the hooks
2. Make a PR!

## Smart Download work in progress

Development includes lazy framework caching and a bounded download scheduler. Game content still requires a complete local replica; room streaming is not enabled. See [implementation status and acceptance gaps](docs/smart-download.md).
