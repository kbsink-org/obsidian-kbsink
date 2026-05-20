import * as path from "path";
import {
	App,
	FileSystemAdapter,
	getLanguage,
	Modal,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	Vault,
	normalizePath,
	requestUrl,
} from "obsidian";
import type {
	KbsinkLogPayload,
	WasmArticleJSON,
	WasmConvertResponse,
} from "./kbsink-wasm";

type KbsinkWasmModule = typeof import("./kbsink-wasm");

// --- i18n (inlined so main.js has no require('./i18n') at runtime) ---

type MessageKey =
	| "command.importUrl"
	| "modal.title"
	| "modal.urlLabel"
	| "modal.urlPlaceholder"
	| "modal.convertButton"
	| "notice.enterUrl"
	| "notice.failed"
	| "notice.outsideVault"
	| "notice.saved"
	| "notice.savedPathSuffix"
	| "notice.error"
	| "settings.title"
	| "settings.introBeforeWasm"
	| "settings.introAfterWasm"
	| "settings.pluginName"
	| "settings.pluginNameDesc"
	| "settings.pluginPlaceholder"
	| "settings.outputFolder"
	| "settings.outputFolderDesc"
	| "settings.outputPlaceholder"
	| "settings.timeout"
	| "settings.timeoutDesc"
	| "settings.wasmDebug"
	| "settings.wasmDebugDesc"
	| "error.vaultNotLocal"
	| "error.wasmNotLoaded"
	| "error.manifestDirMissing"
	| "error.vaultNotFolder"
	| "error.wasmFailure"
	| "error.writeFailed"
	| "label.untitled";

type Messages = Record<MessageKey, string>;

const I18N_EN: Messages = {
	"command.importUrl": "Import URL with kbsink",
	"modal.title": "Import URL (kbsink)",
	"modal.urlLabel": "Article or share URL",
	"modal.urlPlaceholder": "https://...",
	"modal.convertButton": "Convert & save",
	"notice.enterUrl": "Enter a URL.",
	"notice.failed": "kbsink failed",
	"notice.outsideVault": "Output is outside vault: {{path}}",
	"notice.saved": "Saved: {{title}}",
	"notice.savedPathSuffix": " → {{path}}",
	"notice.error": "kbsink error: {{msg}}",
	"settings.title": "Kbsink",
	"settings.introBeforeWasm":
		"Converts WeChat / Xiaohongshu / Douyin links using the bundled ",
	"settings.introAfterWasm":
		" (same logic as kbsink-cli). No external binary. Output goes under the folder below.",
	"settings.pluginName": "Plugin name (optional)",
	"settings.pluginNameDesc":
		"If set, passed as plugin (wechat, xhs, douyin). Leave empty to infer from the URL.",
	"settings.pluginPlaceholder": "(auto from URL)",
	"settings.outputFolder": "Output folder (under vault)",
	"settings.outputFolderDesc": "Article subfolders and markdown are created here.",
	"settings.outputPlaceholder": "KbsinkImports",
	"settings.timeout": "Timeout (ms)",
	"settings.timeoutDesc":
		"Total time for the whole import (article + all assets). WeChat pages can take several minutes over Obsidian requestUrl; if you see timeout errors, raise this (default 15 minutes).",
	"settings.wasmDebug": "WASM debug logs",
	"settings.wasmDebugDesc":
		"Also print debug-level lines from kbsink.wasm to the developer console (info/warn/error always).",
	"error.vaultNotLocal":
		"Cannot write to this vault (adapter does not support folder writes).",
	"error.wasmNotLoaded": "obsidian-kbsink: WASM bridge not loaded",
	"error.manifestDirMissing":
		"obsidian-kbsink: manifest.dir is missing; cannot locate kbsink-wasm.js next to main.js.",
	"error.vaultNotFolder":
		"obsidian-kbsink: vault is not a local folder; cannot resolve relative manifest.dir.",
	"error.wasmFailure": "kbsink WASM returned failure",
	"error.writeFailed": "failed to write vault files",
	"label.untitled": "(untitled)",
};

const I18N_ZH: Messages = {
	"command.importUrl": "使用 kbsink 导入链接",
	"modal.title": "导入链接 (kbsink)",
	"modal.urlLabel": "文章或分享链接",
	"modal.urlPlaceholder": "https://...",
	"modal.convertButton": "转换并保存",
	"notice.enterUrl": "请输入链接。",
	"notice.failed": "kbsink 转换失败",
	"notice.outsideVault": "输出路径在库外：{{path}}",
	"notice.saved": "已保存：{{title}}",
	"notice.savedPathSuffix": " → {{path}}",
	"notice.error": "kbsink 错误：{{msg}}",
	"settings.title": "Kbsink",
	"settings.introBeforeWasm": "使用内置 ",
	"settings.introAfterWasm":
		" 将微信 / 小红书 / 抖音链接转为 Markdown（与 kbsink-cli 相同逻辑，无需外部可执行文件）。文章保存在下方文件夹中。",
	"settings.pluginName": "插件名称（可选）",
	"settings.pluginNameDesc":
		"若填写，将作为 plugin 传入（wechat、xhs、douyin）；留空则根据 URL 自动识别。",
	"settings.pluginPlaceholder": "（根据 URL 自动）",
	"settings.outputFolder": "输出文件夹（库内）",
	"settings.outputFolderDesc": "在此创建文章子文件夹与 Markdown 文件。",
	"settings.outputPlaceholder": "KbsinkImports",
	"settings.timeout": "超时（毫秒）",
	"settings.timeoutDesc":
		"整次导入的总时限（正文 + 全部资源）。微信正文经 Obsidian requestUrl 拉取可能需数分钟；若超时请增大（默认 15 分钟）。",
	"settings.wasmDebug": "WASM 调试日志",
	"settings.wasmDebugDesc":
		"同时将 kbsink.wasm 的 debug 级别日志输出到开发者控制台（info/warn/error 始终输出）。",
	"error.vaultNotLocal": "无法写入当前库（存储适配器不支持文件夹写入）。",
	"error.wasmNotLoaded": "obsidian-kbsink：WASM 桥接未加载",
	"error.manifestDirMissing":
		"obsidian-kbsink：缺少 manifest.dir，无法定位 kbsink-wasm.js。",
	"error.vaultNotFolder":
		"obsidian-kbsink：库不是本地文件夹，无法解析相对 manifest.dir。",
	"error.wasmFailure": "kbsink WASM 返回失败",
	"error.writeFailed": "写入库文件失败",
	"label.untitled": "（无标题）",
};

function resolveLocale(appLang: string): "en" | "zh" {
	const code = appLang.trim().toLowerCase().replace(/_/g, "-");
	if (code === "zh" || code.startsWith("zh-")) {
		return "zh";
	}
	return "en";
}

function appLanguage(): string {
	try {
		return getLanguage();
	} catch {
		// Obsidian < 1.8.7
	}
	const stored = localStorage.getItem("language");
	if (stored) {
		return stored;
	}
	const momentLocale = (
		window as unknown as { moment?: { locale?: () => string } }
	).moment?.locale?.();
	if (momentLocale) {
		return momentLocale;
	}
	return "en";
}

function formatI18n(template: string, vars?: Record<string, string>): string {
	if (!vars) {
		return template;
	}
	return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "");
}

function t(key: MessageKey, vars?: Record<string, string>): string {
	const locale = resolveLocale(appLanguage());
	const messages = locale === "zh" ? I18N_ZH : I18N_EN;
	const template = messages[key] ?? I18N_EN[key] ?? key;
	return formatI18n(template, vars);
}

// --- plugin ---

interface KbsinkJson {
	ok: boolean;
	error?: string;
	title?: string;
	/** Absolute path on local disk (vault root). */
	markdown_path?: string;
	/** Vault-relative path to the new note (forward slashes). */
	vault_rel_path?: string;
}

interface KbsinkSettings {
	/** Optional. Passed to WASM as plugin (wechat, xhs, douyin). Empty = infer from URL. */
	pluginName: string;
	/** Folder under vault root where article folders are written. */
	outputFolder: string;
	/** Network timeout for fetch + convert (ms). */
	timeoutMs: number;
	/** Log WASM debug lines to the developer console. */
	wasmDebugLogs: boolean;
}

const DEFAULT_SETTINGS: KbsinkSettings = {
	pluginName: "",
	outputFolder: "KbsinkImports",
	/** WeChat article + images; host requestUrl can take several minutes for large HTML. */
	timeoutMs: 900_000,
	wasmDebugLogs: false,
};

function emitKbsinkWasmLog(payload: KbsinkLogPayload, debugEnabled: boolean): void {
	if (payload.level === "debug" && !debugEnabled) {
		return;
	}
	const fields =
		payload.fields && Object.keys(payload.fields).length > 0
			? payload.fields
			: undefined;
	const prefix = `[kbsink:${payload.level}] ${payload.msg}`;
	const isHTTP = payload.msg.includes("http") || payload.msg.includes("fetch article");
	const isParse =
		payload.msg.startsWith("parse result") || payload.msg === "download assets starting";
	if (isHTTP || isParse) {
		if (payload.msg === "parse result json" && typeof payload.fields?.data === "string") {
			try {
				console.info(prefix, JSON.parse(payload.fields.data as string));
			} catch {
				console.info(prefix, payload.fields ?? {});
			}
		} else {
			console.info(prefix, payload.fields ?? {});
		}
		return;
	}
	switch (payload.level) {
		case "error":
			console.error(prefix, fields ?? "");
			break;
		case "warn":
			console.warn(prefix, fields ?? "");
			break;
		case "debug":
			console.debug(prefix, fields ?? "");
			break;
		default:
			console.info(prefix, fields ?? "");
	}
}

/**
 * Obsidian often sets {@link Plugin.manifest}.dir as a path relative to the vault root
 * (e.g. `.obsidian/plugins/obsidian-kbsink`). Node `require()` resolves that against the
 * process cwd, not the vault, so we must join with the vault base path when not absolute.
 */
function absolutePluginInstallDir(plugin: Plugin): string {
	const dir = plugin.manifest.dir;
	if (!dir) {
		throw new Error(t("error.manifestDirMissing"));
	}
	if (path.isAbsolute(dir)) {
		return path.normalize(dir);
	}
	const adapter = plugin.app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return path.normalize(path.join(adapter.getBasePath(), dir));
	}
	// Mobile / sync vaults: manifest.dir is relative to the vault root.
	return normalizePath(dir);
}

async function mkdirpVault(vault: Vault, normalizedFilePath: string): Promise<void> {
	const norm = normalizePath(normalizedFilePath);
	const parts = norm.split("/").filter(Boolean);
	parts.pop();
	let acc = "";
	for (const p of parts) {
		acc = acc ? `${acc}/${p}` : p;
		if (!(await vault.adapter.exists(acc))) {
			await vault.adapter.mkdir(acc);
		}
	}
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
	const u8 = new Uint8Array(buf.byteLength);
	u8.set(buf);
	return u8.buffer;
}

async function writeWasmResultToVault(
	vault: Vault,
	outputFolder: string,
	data: WasmArticleJSON
): Promise<string> {
	const root = normalizePath(outputFolder);
	const articleDir = normalizePath(path.join(root, data.safeTitle));
	const mdRel = normalizePath(path.join(articleDir, `${data.safeTitle}.md`));

	await mkdirpVault(vault, mdRel);
	await vault.adapter.write(mdRel, data.markdown);

	for (const asset of data.assets) {
		if (!asset.dataBase64) continue;
		const rel = normalizePath(path.join(articleDir, asset.relativePath));
		await mkdirpVault(vault, rel);
		const buf = Buffer.from(asset.dataBase64, "base64");
		await vault.adapter.writeBinary(rel, bufferToArrayBuffer(buf));
	}
	return mdRel;
}

export default class KbsinkPlugin extends Plugin {
	settings: KbsinkSettings = DEFAULT_SETTINGS;

	/** Loaded from {@link Plugin.manifest}.dir — `__dirname` in main is inside electron.asar, so we must not use it. */
	private kbsinkWasm: KbsinkWasmModule | null = null;

	async onload() {
		const pluginDir = absolutePluginInstallDir(this);
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		this.kbsinkWasm = require(path.join(pluginDir, "kbsink-wasm.js")) as KbsinkWasmModule;
		// `obsidian` resolves from main.js only — register here so kbsink-wasm.js never does require("obsidian").
		this.kbsinkWasm.registerKbsinkObsidianRequestUrl(requestUrl);
		this.kbsinkWasm.setKbsinkHttpTransport?.(
			Platform.isMobileApp ? "requestUrl" : "curl"
		);
		this.kbsinkWasm.setKbsinkRequestUrlPerAssetTimeoutMs?.(180_000);

		await this.loadSettings();
		this.kbsinkWasm.registerKbsinkLogSink((p) =>
			emitKbsinkWasmLog(p, this.settings.wasmDebugLogs)
		);
		this.addSettingTab(new KbsinkSettingTab(this.app, this));
		this.addCommand({
			id: "import-url",
			name: t("command.importUrl"),
			callback: () => {
				new KbsinkURLModal(this.app, this).open();
			},
		});
	}

	onunload(): void {
		this.kbsinkWasm?.removeKbsinkHostHTTPBridge?.();
		this.kbsinkWasm?.removeKbsinkLogBridge?.();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (typeof this.settings.timeoutMs !== "number" || this.settings.timeoutMs < 5000) {
			this.settings.timeoutMs = DEFAULT_SETTINGS.timeoutMs;
		}
		// Older builds defaulted to 5m; WeChat article HTML alone can take that long.
		if (this.settings.timeoutMs <= 300_000) {
			this.settings.timeoutMs = DEFAULT_SETTINGS.timeoutMs;
			await this.saveSettings();
		}
		if (typeof this.settings.wasmDebugLogs !== "boolean") {
			this.settings.wasmDebugLogs = DEFAULT_SETTINGS.wasmDebugLogs;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** User-visible string for the current Obsidian UI language. */
	translate(key: MessageKey, vars?: Record<string, string>): string {
		return t(key, vars);
	}

	private wasm(): KbsinkWasmModule {
		if (!this.kbsinkWasm) {
			throw new Error(t("error.wasmNotLoaded"));
		}
		return this.kbsinkWasm;
	}

	vaultBasePath(): string | null {
		const a = this.app.vault.adapter;
		if (a instanceof FileSystemAdapter) {
			return a.getBasePath();
		}
		return null;
	}

	async runKbsink(url: string): Promise<KbsinkJson> {
		const base = this.vaultBasePath();
		try {
			await this.wasm().ensureKbsinkWasmLoaded();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg };
		}

		const plugin = this.settings.pluginName.trim();
		const trimmedUrl = url.trim();

		const wasmReq = {
			url: trimmedUrl,
			...(plugin !== "" ? { plugin } : {}),
			videoMode: "embed",
			timeoutMs: this.settings.timeoutMs,
			outputRoot: "output",
		};

		let parsed: WasmConvertResponse;
		try {
			parsed = this.wasm().kbsinkWasmConvertJSON(wasmReq);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg };
		}

		if (!parsed.ok || !parsed.result) {
			return {
				ok: false,
				error: parsed.error || t("error.wasmFailure"),
			};
		}

		const res = parsed.result;
		try {
			const mdRel = await writeWasmResultToVault(
				this.app.vault,
				this.settings.outputFolder,
				res
			);
			const absMd = base
				? path.join(base, ...mdRel.split("/").filter(Boolean))
				: undefined;
			return {
				ok: true,
				title: res.title,
				markdown_path: absMd,
				vault_rel_path: mdRel,
			};
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg || t("error.writeFailed") };
		}
	}
}

class KbsinkURLModal extends Modal {
	constructor(
		app: App,
		private plugin: KbsinkPlugin
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		const tr = (key: MessageKey, vars?: Record<string, string>) =>
			this.plugin.translate(key, vars);
		contentEl.createEl("h2", { text: tr("modal.title") });
		let input: HTMLInputElement | undefined;
		new Setting(contentEl)
			.setName(tr("modal.urlLabel"))
			.addText((tc) => {
				input = tc.inputEl;
				tc.setPlaceholder(tr("modal.urlPlaceholder"));
				tc.inputEl.style.width = "100%";
			});
		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(tr("modal.convertButton")).onClick(async () => {
				const url = input?.value?.trim() ?? "";
				if (!url) {
					new Notice(tr("notice.enterUrl"));
					return;
				}
				btn.setDisabled(true);
				try {
					const res = await this.plugin.runKbsink(url);
					if (!res.ok) {
						new Notice(res.error ?? tr("notice.failed"), 8000);
						return;
					}
					const rel =
						res.vault_rel_path ??
						(() => {
							const base = this.plugin.vaultBasePath();
							if (base && res.markdown_path) {
								return normalizePath(
									path.relative(base, res.markdown_path)
								);
							}
							return null;
						})();
					if (rel) {
						if (rel.startsWith("..")) {
							new Notice(
								tr("notice.outsideVault", {
									path: res.markdown_path ?? rel,
								}),
								10000
							);
						} else {
							const f = this.app.vault.getAbstractFileByPath(rel);
							if (f instanceof TFile) {
								await this.app.workspace.getLeaf(false).openFile(f);
							}
						}
					}
					const title = res.title ?? tr("label.untitled");
					const savedMsg =
						tr("notice.saved", { title }) +
						(rel ? tr("notice.savedPathSuffix", { path: rel }) : "");
					new Notice(savedMsg, 6000);
					this.close();
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					new Notice(tr("notice.error", { msg }), 12000);
				} finally {
					btn.setDisabled(false);
				}
			})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class KbsinkSettingTab extends PluginSettingTab {
	plugin: KbsinkPlugin;

	constructor(app: App, plugin: KbsinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const tr = (key: MessageKey, vars?: Record<string, string>) =>
			this.plugin.translate(key, vars);
		containerEl.empty();
		containerEl.createEl("h2", { text: tr("settings.title") });
		const intro = containerEl.createEl("p");
		intro.appendText(tr("settings.introBeforeWasm"));
		intro.appendText("kbsink.wasm");
		intro.appendText(tr("settings.introAfterWasm"));

		new Setting(containerEl)
			.setName(tr("settings.pluginName"))
			.setDesc(tr("settings.pluginNameDesc"))
			.addText((text) =>
				text
					.setPlaceholder(tr("settings.pluginPlaceholder"))
					.setValue(this.plugin.settings.pluginName)
					.onChange(async (v) => {
						this.plugin.settings.pluginName = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(tr("settings.outputFolder"))
			.setDesc(tr("settings.outputFolderDesc"))
			.addText((text) =>
				text
					.setPlaceholder(tr("settings.outputPlaceholder"))
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (v) => {
						this.plugin.settings.outputFolder =
							v || DEFAULT_SETTINGS.outputFolder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(tr("settings.timeout"))
			.setDesc(tr("settings.timeoutDesc"))
			.addText((text) => {
				text.setPlaceholder(String(DEFAULT_SETTINGS.timeoutMs));
				text.setValue(String(this.plugin.settings.timeoutMs));
				text.onChange(async (v) => {
					const n = parseInt(v.trim(), 10);
					this.plugin.settings.timeoutMs =
						Number.isFinite(n) && n >= 5000
							? n
							: DEFAULT_SETTINGS.timeoutMs;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("settings.wasmDebug"))
			.setDesc(tr("settings.wasmDebugDesc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.wasmDebugLogs).onChange(async (v) => {
					this.plugin.settings.wasmDebugLogs = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
