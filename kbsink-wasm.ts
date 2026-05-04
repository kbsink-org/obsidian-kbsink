import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";

const nodeRequire = createRequire(__filename);

/** Response from globalThis.kbsinkConvertJSON (kbsink-cli cmd/kbsink-wasm). */
export interface WasmConvertResponse {
	ok: boolean;
	error?: string;
	result?: WasmArticleJSON;
}

export interface WasmArticleJSON {
	title: string;
	safeTitle: string;
	accountName?: string;
	sourceUrl: string;
	outputDir: string;
	markdownPath: string;
	markdown: string;
	rawHtml?: string;
	plugin: string;
	assets: WasmAssetJSON[];
}

export interface WasmAssetJSON {
	type: string;
	sourceUrl?: string;
	relativePath: string;
	fileName: string;
	contentType?: string;
	dataBase64?: string;
}

let wasmInit: Promise<void> | null = null;

function wasmDir(): string {
	return path.join(path.dirname(__filename), "wasm");
}

/**
 * Loads wasm_exec.js + kbsink.wasm once and waits until globalThis.kbsinkConvertJSON exists.
 * go.run() never resolves while the Go main blocks on select{}; we must not await it.
 */
export function ensureKbsinkWasmLoaded(): Promise<void> {
	if (wasmInit) return wasmInit;
	wasmInit = (async () => {
		const dir = wasmDir();
		const wasmExec = path.join(dir, "wasm_exec.js");
		const wasmPath = path.join(dir, "kbsink.wasm");
		if (!fs.existsSync(wasmExec)) {
			throw new Error(`Missing ${wasmExec} (sync from Go: GOROOT/lib/wasm/wasm_exec.js).`);
		}
		if (!fs.existsSync(wasmPath)) {
			throw new Error(
				`Missing ${wasmPath}. Copy kbsink.wasm from a kbsink-cli js/wasm build (see README).`
			);
		}
		// Load Go wasm bridge (sets globalThis.Go).
		nodeRequire(wasmExec);

		const Go = (globalThis as unknown as { Go?: new () => GoInstance }).Go;
		if (typeof Go !== "function") {
			throw new Error("wasm_exec.js did not define globalThis.Go");
		}

		const go = new Go();
		const wasmBytes = fs.readFileSync(wasmPath);
		const { instance } = await WebAssembly.instantiate(
			wasmBytes,
			go.importObject
		);
		void go.run(instance);

		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			const fn = (globalThis as unknown as { kbsinkConvertJSON?: unknown })
				.kbsinkConvertJSON;
			if (typeof fn === "function") return;
			await new Promise((r) => setTimeout(r, 25));
		}
		throw new Error(
			"kbsink WASM did not expose globalThis.kbsinkConvertJSON within 60s."
		);
	})();
	return wasmInit;
}

/** Minimal surface of Go's wasm_exec.js `Go` class we use. */
interface GoInstance {
	importObject: WebAssembly.Imports;
	run(instance: WebAssembly.Instance): Promise<void>;
}

export function kbsinkWasmConvertJSON(payload: {
	url: string;
	plugin?: string;
	videoMode?: string;
	timeoutMs?: number;
	outputRoot?: string;
}): WasmConvertResponse {
	const fn = (globalThis as unknown as { kbsinkConvertJSON?: (s: string) => string })
		.kbsinkConvertJSON;
	if (typeof fn !== "function") {
		throw new Error("kbsink WASM is not loaded; call ensureKbsinkWasmLoaded() first.");
	}
	const raw = fn(JSON.stringify(payload));
	let parsed: WasmConvertResponse;
	try {
		parsed = JSON.parse(raw) as WasmConvertResponse;
	} catch {
		throw new Error(`Invalid JSON from kbsinkConvertJSON: ${raw.slice(0, 500)}`);
	}
	return parsed;
}
