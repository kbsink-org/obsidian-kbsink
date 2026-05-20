# Obsidian Kbsink

[English](README.md)

Obsidian 插件（桌面端与手机端）：粘贴 **微信 / 小红书 / 抖音** 链接，把 **Markdown 与图片/视频** 保存到库中。转换由内置的 **`kbsink.wasm`** 完成（与 [kbsink-cli](https://github.com/kbsink-cli) 同一套转换栈；**不需要**系统里再装外部 `kbsink` 可执行文件）。

## 构建

```bash
npm install
# 将 wasm 放到仓库根目录 wasm/（见下文），然后：
npm run build
```

`npm run build` 会生成可直接发布的 **`dist/`** 目录：

- `dist/main.js`、`dist/kbsink-wasm.js`
- `dist/manifest.json`
- `dist/wasm/wasm_exec.js`、`dist/wasm/kbsink.wasm`

将 **`dist/` 内的全部内容** 复制到：

`<库路径>/.obsidian/plugins/obsidian-kbsink/`

（该目录下应有 `manifest.json`、`main.js`、`kbsink-wasm.js` 以及 `wasm/` — Obsidian 默认从与 `manifest.json` 同级的 `main.js` 启动。）

`dist/` 已被 git 忽略；版本控制里通常只保留源码与仓库根目录的 `wasm/`。

### 发布 Obsidian 插件（本仓库 GitHub Release）

这里的「发布」指：**打出可安装的第三方插件包并挂到本仓库的 GitHub Release**，不是推送到 Obsidian 官方插件服务器。

推送与 **`manifest.json` 中 `version`** 一致的 **`v*`** 标签（例如 tag `v1.0.1` 对应 `"version": "1.0.1"`）会触发 **`.github/workflows/release.yml`**：`npm ci` → `npm run build` → 生成 **`obsidian-kbsink-<tag>.zip`**（及 `.sha256`）并上传到 Release。zip 内为标准插件目录（`manifest.json`、`main.js`、`wasm/` 等），解压到 **`<库>/.obsidian/plugins/obsidian-kbsink/`** 即可使用；也可用 **BRAT** 等工具指向本仓库的 Release。

若要出现在 Obsidian **设置 → 社区插件** 的官方列表中，需要另行向 [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 提交审核，与上述 workflow 无关。

### 监听模式（开发）

```bash
npm run dev
```

只会把编译后的 `.js` 输出到 **`dist/`**（与 `tsconfig` 的 `outDir` 一致）。克隆后请先 **`npm run build` 一次**，以便 `dist/` 里也有 `manifest.json` 和 `wasm/`；之后可用 `dev` 在迭代时刷新 JS。

## WebAssembly 资源（仓库 `wasm/`）

开发时使用 **`package.json` 同级**的 **`wasm/`**。`npm run build` 会把其中的文件复制到 **`dist/wasm/`**。这些文件必须来自构建 `.wasm` 时所用的 **同一套 Go 工具链**。

### 从 GitHub Release 获取（推荐）

[kbsink-cli releases](https://github.com/kbsink-org/kbsink-cli/releases) 会发布 **`kbsink_<tag>_wasm_js.tar.gz`**。在本仓库中：

```bash
npm run wasm:pull -- v1.0.2
# 或：KBSINK_CLI_TAG=v1.0.2 npm run wasm:pull
npm run build
```

需要 `curl` 与 `tar`。若 Release 附带包含该 tarball 的 `SHA256SUMS.txt`，脚本会校验哈希（设置 `SKIP_CHECKSUM=1` 可跳过）。可用 `KBSINK_CLI_REPO=owner/kbsink-cli` 覆盖仓库。

### 手动复制

将 **`wasm_exec.js`** 与 **`kbsink.wasm`** 放到仓库 **`wasm/`** 下（前者来自 `$(go env GOROOT)/lib/wasm/` 或 `misc/wasm/`，后者来自本地对 `kbsink-cli` 的 `cmd/kbsink-wasm` 使用 `GOOS=js GOARCH=wasm` 的构建产物）。

`wasm_exec.js` 来自 Go 发行版（BSD 许可）。

## 环境要求

- **Obsidian 1.4+**（桌面端或 iOS / Android 手机端）。
- 支持 **WebAssembly**（当前桌面与手机客户端）。
- **桌面端**：WASM HTTP 走同步 **curl**。**手机端**：走 Obsidian **`requestUrl`**（无 `curl`）。

## 使用

命令面板 → **Import URL with kbsink** → 输入 URL → 结果写入设置里配置的文件夹（默认在库根目录下的 `KbsinkImports`），目录结构与 CLI 一致（`<folder>/<安全标题>/<title>.md`、`images/`、`videos/`）。

## 测试

1. 填好仓库 **`wasm/`**，执行 `npm run build`。
2. 将 **`dist/`** 内容复制到 `<库>/.obsidian/plugins/obsidian-kbsink/`。
3. 启用插件，执行 **Import URL with kbsink**，粘贴受支持的 URL。

### 常见问题

- **缺少 wasm/…**：执行 `npm run wasm:pull -- <tag>` 或把文件复制到仓库 **`wasm/`**，再 `npm run build`。
- **无法写入库**：库的适配器需支持创建文件夹与文件（手机端与桌面端库均可；绝对磁盘路径仅桌面端可用）。
- **WASM 超时 / 网络错误**：在设置中增大 **Timeout (ms)**；部分站点较慢或被拦截。
- **微信链接在开发者工具里报 CORS、或第二次提示「Go program has already exited」**：插件通过 **`globalThis.kbsinkHTTPRoundTrip`** 把 Go wasm 里的 **`net/http`** 接到 Obsidian **`requestUrl`**（正文与图片均走该通道；UA 由 wasm 内 driver 设置）。请使用 **kbsink-cli** 编出的 **`kbsink.wasm`** 与当前 **`kbsink-wasm.js`**，然后 `npm run build` 复制 `dist/`。
- **卡在 HTTP、无后续 Go 日志**：Go wasm 的 **`kbsinkConvertJSON` 是同步调用**，不能用返回 Promise 的 HTTP。**桌面端**用 **同步 `curl`**（控制台 **`[kbsink:http] curl ←`**，默认 **`--noproxy *`**）。**手机端**用 **同步 `requestUrl`**（**`[kbsink:http] requestUrl ←`**）。请 **`npm run build`** 后整包复制 **`dist/`** 并重载插件。
