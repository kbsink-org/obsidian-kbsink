import * as path from "path";
import {
	App,
	FileSystemAdapter,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	Vault,
	normalizePath,
} from "obsidian";
import {
	ensureKbsinkWasmLoaded,
	kbsinkWasmConvertJSON,
	type WasmArticleJSON,
	type WasmConvertResponse,
} from "./kbsink-wasm";

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
}

const DEFAULT_SETTINGS: KbsinkSettings = {
	pluginName: "",
	outputFolder: "KbsinkImports",
	timeoutMs: 120_000,
};

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

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new KbsinkSettingTab(this.app, this));
		this.addCommand({
			id: "import-url",
			name: "Import URL with kbsink",
			callback: () => {
				new KbsinkURLModal(this.app, this).open();
			},
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (typeof this.settings.timeoutMs !== "number" || this.settings.timeoutMs < 5000) {
			this.settings.timeoutMs = DEFAULT_SETTINGS.timeoutMs;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
		if (!base) {
			return {
				ok: false,
				error: "Vault is not a local folder (FileSystemAdapter required).",
			};
		}
		try {
			await ensureKbsinkWasmLoaded();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg };
		}

		const plugin = this.settings.pluginName.trim();
		const wasmReq = {
			url: url.trim(),
			...(plugin !== "" ? { plugin } : {}),
			videoMode: "link",
			timeoutMs: this.settings.timeoutMs,
			outputRoot: "output",
		};

		let parsed: WasmConvertResponse;
		try {
			parsed = kbsinkWasmConvertJSON(wasmReq);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg };
		}

		if (!parsed.ok || !parsed.result) {
			return {
				ok: false,
				error: parsed.error || "kbsink WASM returned failure",
			};
		}

		const res = parsed.result;
		try {
			const mdRel = await writeWasmResultToVault(
				this.app.vault,
				this.settings.outputFolder,
				res
			);
			const absMd = path.join(base, ...mdRel.split("/").filter(Boolean));
			return {
				ok: true,
				title: res.title,
				markdown_path: absMd,
				vault_rel_path: mdRel,
			};
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg || "failed to write vault files" };
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
		contentEl.createEl("h2", { text: "Import URL (kbsink)" });
		let input: HTMLInputElement | undefined;
		new Setting(contentEl)
			.setName("Article or share URL")
			.addText((tc) => {
				input = tc.inputEl;
				tc.setPlaceholder("https://...");
				tc.inputEl.style.width = "100%";
			});
		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Convert & save").onClick(async () => {
				const url = input?.value?.trim() ?? "";
				if (!url) {
					new Notice("Enter a URL.");
					return;
				}
				btn.setDisabled(true);
				try {
					const res = await this.plugin.runKbsink(url);
					if (!res.ok) {
						new Notice(res.error ?? "kbsink failed", 8000);
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
								`Output is outside vault: ${res.markdown_path}`,
								10000
							);
						} else {
							const f = this.app.vault.getAbstractFileByPath(rel);
							if (f instanceof TFile) {
								await this.app.workspace.getLeaf(false).openFile(f);
							}
						}
					}
					new Notice(
						`Saved: ${res.title ?? "(untitled)"}${rel ? ` → ${rel}` : ""}`,
						6000
					);
					this.close();
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					new Notice(`kbsink error: ${msg}`, 12000);
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
		containerEl.empty();
		containerEl.createEl("h2", { text: "Kbsink" });
		const intro = containerEl.createEl("p");
		intro.appendText(
			"Converts WeChat / Xiaohongshu / Douyin links using the bundled "
		);
		intro.appendText("kbsink.wasm");
		intro.appendText(
			" (same logic as kbsink-cli). No external binary. Output goes under the folder below."
		);

		new Setting(containerEl)
			.setName("Plugin name (optional)")
			.setDesc(
				"If set, passed as plugin (wechat, xhs, douyin). Leave empty to infer from the URL."
			)
			.addText((t) =>
				t
					.setPlaceholder("(auto from URL)")
					.setValue(this.plugin.settings.pluginName)
					.onChange(async (v) => {
						this.plugin.settings.pluginName = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Output folder (under vault)")
			.setDesc("Article subfolders and markdown are created here.")
			.addText((t) =>
				t
					.setPlaceholder("KbsinkImports")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (v) => {
						this.plugin.settings.outputFolder =
							v || DEFAULT_SETTINGS.outputFolder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Timeout (ms)")
			.setDesc("How long the WASM fetch/convert may run (minimum 5000).")
			.addText((t) => {
				t.setPlaceholder(String(DEFAULT_SETTINGS.timeoutMs));
				t.setValue(String(this.plugin.settings.timeoutMs));
				t.onChange(async (v) => {
					const n = parseInt(v.trim(), 10);
					this.plugin.settings.timeoutMs =
						Number.isFinite(n) && n >= 5000
							? n
							: DEFAULT_SETTINGS.timeoutMs;
					await this.plugin.saveSettings();
				});
			});
	}
}
