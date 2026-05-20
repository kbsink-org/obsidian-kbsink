# Obsidian Kbsink

[中文说明](README-zh.md)

Obsidian plugin (desktop and mobile): paste a **WeChat / Xiaohongshu / Douyin** URL and save **markdown + images/videos** into your vault using the bundled **`kbsink.wasm`** (same conversion stack as [kbsink-cli](https://github.com/kbsink-org/kbsink-cli); **no external `kbsink` binary**).

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

### 发布 Obsidian 插件（本仓库 GitHub Release）

这里的「发布」指的是：**打出可安装的第三方插件包，并挂到本仓库的 GitHub Release**，不是推送到 Obsidian 服务器。

推送与 **`manifest.json` 里 `version`** 一致的 **`v*`** 标签（例如 tag `v1.0.1` 对应 `"version": "1.0.1"`）会跑 **`.github/workflows/release.yml`**：`npm ci` → `npm run build` → 生成 **`obsidian-kbsink-<tag>.zip`**（以及 `.sha256`）并作为 Release 资源上传。zip 内是标准插件目录（`manifest.json`、`main.js`、`wasm/` 等），解压到 **`<库>/.obsidian/plugins/obsidian-kbsink/`** 即可用；也可用 **BRAT** 等工具指向本仓库的 Release。

若要出现在 Obsidian **设置 → 社区插件** 的官方列表里，需要另外向 [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 走提交流程，与上述 workflow 无关。

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

- **Obsidian 1.4+** on desktop or mobile (iOS / Android).
- **WebAssembly** support (desktop Electron and current mobile app).
- **Desktop**: sync `curl` for WASM HTTP (see common issues). **Mobile**: Obsidian **`requestUrl`** (no `curl`).

## Usage

Command palette → **Import URL with kbsink** → enter URL → output is written under the configured folder (default `KbsinkImports` at vault root), same layout as the CLI (`<folder>/<safe title>/<title>.md`, `images/`, `videos/`).

## Testing

1. Fill repo **`wasm/`**, then `npm run build`.
2. Copy **`dist/`** contents into `<Vault>/.obsidian/plugins/obsidian-kbsink/`.
3. Enable the plugin, run **Import URL with kbsink**, paste a supported URL.

### Common issues

- **Missing wasm/…**: Run `npm run wasm:pull -- <tag>` or copy files into repo **`wasm/`**, then `npm run build` again.
- **Cannot write to vault**: The vault adapter must support creating folders and files (mobile and desktop vaults are supported; absolute disk paths are desktop-only).
- **WASM timeout / network errors**: Increase **Timeout (ms)** in settings; some hosts are slow or blocked.
- **Stuck at HTTP / no further Go logs**: Go **`kbsinkConvertJSON`** is synchronous; **`kbsinkHTTPRoundTrip`** must return JSON immediately (not a Promise). **Desktop** uses **sync `curl`** (`[kbsink:http] curl ←`). **Mobile** uses **sync `requestUrl`** (`[kbsink:http] requestUrl ←`). After `npm run build`, copy all of **`dist/`** and reload. You still need **`kbsink.wasm`** from **`cmd/kbsink-wasm`** / **`bridge.go`**.
