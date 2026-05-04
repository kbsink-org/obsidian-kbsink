# Obsidian Kbsink

Desktop plugin: paste a **WeChat / Xiaohongshu / Douyin** URL and save **markdown + images** into your vault using the bundled **`kbsink.wasm`** (same conversion stack as [kbsink-cli](https://github.com/kbsink-org/kbsink-cli); **no external `kbsink` binary**).

## Build

```bash
npm install
# Put wasm in repo root wasm/ (see below), then:
npm run build
```

`npm run build` writes a **`dist/`** folder that is **ready to publish** into your vault:

- `dist/main.js`, `dist/kbsink-wasm.js`
- `dist/manifest.json`
- `dist/wasm/wasm_exec.js`, `dist/wasm/kbsink.wasm`

Copy **everything inside `dist/`** into:

`<Vault>/.obsidian/plugins/obsidian-kbsink/`

(That folder should contain `manifest.json`, `main.js`, `kbsink-wasm.js`, and `wasm/` — Obsidian’s default entry is `main.js` next to `manifest.json`.)

`dist/` is gitignored; only source and `wasm/` at repo root are kept under version control as you prefer.

### Watch mode (development)

```bash
npm run dev
```

Emits only compiled `.js` into **`dist/`** (same `tsconfig` `outDir`). Run **`npm run build` once** after clone so `dist/` also gets `manifest.json` and `wasm/`; afterwards `dev` can refresh the JS while you iterate.

## WebAssembly assets (repo `wasm/`)

Development sources use **`wasm/`** at the **repository root** (next to `package.json`). `npm run build` copies those files into **`dist/wasm/`**. They must come from the **same Go toolchain** that built the `.wasm`.

### From GitHub Release (recommended)

[kbsink-cli releases](https://github.com/kbsink-org/kbsink-cli/releases) publish **`kbsink_<tag>_wasm_js.tar.gz`**. From this repo:

```bash
npm run wasm:pull -- v1.0.2
# or: KBSINK_CLI_TAG=v1.0.2 npm run wasm:pull
npm run build
```

Requires `curl` and `tar`. If the release ships `SHA256SUMS.txt` including that tarball, the script verifies the hash (set `SKIP_CHECKSUM=1` to skip). Override repo with `KBSINK_CLI_REPO=owner/kbsink-cli`.

### Manual copy

Put **`wasm_exec.js`** and **`kbsink.wasm`** under repo **`wasm/`** (from `$(go env GOROOT)/lib/wasm/` or `misc/wasm/`, and a local `GOOS=js GOARCH=wasm` build of `kbsink-cli` `cmd/kbsink-wasm`).

`wasm_exec.js` is from the Go distribution (BSD license).

## Prerequisites

- **Desktop Obsidian** (local vault with `FileSystemAdapter`).
- **Node-style `require`** and **WebAssembly** (Electron desktop).

## Usage

Command palette → **Import URL with kbsink** → enter URL → output is written under the configured folder (default `KbsinkImports` at vault root), same layout as the CLI (`<folder>/<safe title>/<title>.md`, `images/`, `videos/`).

## Testing

1. Fill repo **`wasm/`**, then `npm run build`.
2. Copy **`dist/`** contents into `<Vault>/.obsidian/plugins/obsidian-kbsink/`.
3. Enable the plugin, run **Import URL with kbsink**, paste a supported URL.

### Common issues

- **Missing wasm/…**: Run `npm run wasm:pull -- <tag>` or copy files into repo **`wasm/`**, then `npm run build` again.
- **Vault is not a local folder**: The vault must be a normal folder on disk.
- **WASM timeout / network errors**: Increase **Timeout (ms)** in settings; some hosts are slow or blocked.
