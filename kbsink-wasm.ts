import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Subset of Obsidian `RequestUrlParam` / response — avoid `require("obsidian")` from this file (fails in `kbsink-wasm.js`). */
export interface KbsinkRequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface KbsinkRequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	text: string;
}

export type KbsinkRequestUrlFn = (
	param: KbsinkRequestUrlParam
) => Promise<KbsinkRequestUrlResponse>;

let requestUrlBridge: KbsinkRequestUrlFn | null = null;

/** Per-asset ceiling so one slow CDN URL does not burn the whole import deadline. */
let requestUrlPerAssetTimeoutMs = 180_000;

export function setKbsinkRequestUrlPerAssetTimeoutMs(ms: number): void {
	if (Number.isFinite(ms) && ms >= 10_000) {
		requestUrlPerAssetTimeoutMs = ms;
	}
}

/**
 * Optional; WASM HTTP uses sync `curl` (not Obsidian `requestUrl`) because Go wasm blocks the JS thread.
 * Kept for API compatibility / future hosts.
 */
export function registerKbsinkObsidianRequestUrl(fn: KbsinkRequestUrlFn): void {
	requestUrlBridge = fn;
}

/** Payload from Go wasm [JSLogger] (kbsink-cli cmd/kbsink-wasm jslog.go). */
export interface KbsinkLogPayload {
	level: "debug" | "info" | "warn" | "error";
	msg: string;
	fields?: Record<string, unknown>;
}

export type KbsinkLogSinkFn = (payload: KbsinkLogPayload) => void;

let logSink: KbsinkLogSinkFn | null = null;

/** Call once from `main.ts`. Wires Go wasm logger via `globalThis.kbsinkLog`. */
export function registerKbsinkLogSink(fn: KbsinkLogSinkFn): void {
	logSink = fn;
}

function installKbsinkLogBridge(): void {
	const g = globalThis as unknown as { kbsinkLog?: (json: string) => void };
	g.kbsinkLog = (jsonStr: string) => {
		if (!logSink) return;
		let p: KbsinkLogPayload;
		try {
			p = JSON.parse(jsonStr) as KbsinkLogPayload;
		} catch {
			return;
		}
		if (!p?.msg) return;
		logSink(p);
	};
}

/** Remove host log hook (e.g. on plugin unload). */
export function removeKbsinkLogBridge(): void {
	const g = globalThis as unknown as { kbsinkLog?: unknown };
	delete g.kbsinkLog;
	logSink = null;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	const chunk = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

interface WasmHostHTTPRequest {
	method?: string;
	url: string;
	headers?: Record<string, string>;
	bodyB64?: string;
	timeoutMs?: number;
}

/** Env without proxy vars — broken local proxies (e.g. 127.0.0.1:7897) otherwise hang curl. */
function envWithoutProxy(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const k of [
		"HTTP_PROXY",
		"HTTPS_PROXY",
		"http_proxy",
		"https_proxy",
		"ALL_PROXY",
		"all_proxy",
	]) {
		delete env[k];
	}
	return env;
}

/**
 * Synchronous HTTP for Go wasm [HostTransport]. Mirrors kbsink-cli/scripts/run-wasm.mjs.
 * Must return a JSON string immediately (no Promise) while Go blocks in kbsinkConvertJSON.
 */
function kbsinkHttpRoundTripSyncCurl(jsonStr: string): string {
	console.info("[kbsink:http] wasm→host (raw)", jsonStr);
	let j: WasmHostHTTPRequest;
	try {
		j = JSON.parse(jsonStr) as WasmHostHTTPRequest;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`kbsinkHTTPRoundTrip: invalid JSON (${msg})`);
	}
	if (!j.url) {
		throw new Error("kbsinkHTTPRoundTrip: missing url");
	}
	const method = (j.method ?? "GET").toUpperCase();
	const waitMs =
		typeof j.timeoutMs === "number" && j.timeoutMs > 0
			? j.timeoutMs
			: requestUrlPerAssetTimeoutMs;
	const timeoutSec = Math.max(1, Math.ceil(waitMs / 1000));
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const cp = require("child_process") as typeof import("child_process");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbsink-http-"));
	const bodyPath = path.join(dir, "body");
	const uploadPath = path.join(dir, "upload");
	try {
		const args = [
			"-sS",
			"-L",
			"--noproxy",
			"*",
			"--max-time",
			String(timeoutSec),
			"-o",
			bodyPath,
			"-w",
			"%{http_code}\n%{content_type}",
			"-X",
			method,
			...Object.entries(j.headers ?? {}).flatMap(([k, v]) => ["-H", `${k}: ${v}`]),
		];
		if (j.bodyB64) {
			fs.writeFileSync(uploadPath, Buffer.from(j.bodyB64, "base64"));
			args.push("--data-binary", `@${uploadPath}`);
		}
		args.push(j.url);
		console.info("[kbsink:http] curl →", {
			method,
			url: j.url,
			timeoutSec,
			hasBody: Boolean(j.bodyB64),
		});
		const out = cp.spawnSync("curl", args, {
			encoding: "utf8",
			env: envWithoutProxy(),
		});
		if (out.error) {
			throw out.error;
		}
		if (out.status !== 0) {
			throw new Error(out.stderr?.trim() || `curl exit ${out.status}`);
		}
		const respBody = fs.readFileSync(bodyPath);
		const writeOut = String(out.stdout ?? "").trim();
		const writeLines = writeOut.split("\n");
		const status = Number.parseInt(writeLines[0] ?? "0", 10) || 0;
		const contentType = (writeLines[1] ?? "").trim();
		const headers: Record<string, string> = {};
		if (contentType) {
			headers["Content-Type"] = contentType;
		}
		console.info("[kbsink:http] curl ←", {
			method,
			url: j.url,
			status,
			contentType: contentType || "(none)",
			bodyLen: respBody.length,
		});
		return JSON.stringify({
			status,
			statusText: status >= 200 && status < 400 ? "OK" : "Error",
			headers,
			bodyBase64: respBody.length ? respBody.toString("base64") : "",
		});
	} finally {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

/**
 * Installs `globalThis.kbsinkHTTPRoundTrip` for Go wasm (kbsink-cli cmd/kbsink-wasm HostTransport).
 * Call before any WASM HTTP (e.g. in {@link ensureKbsinkWasmLoaded}).
 */
function installKbsinkHostHTTPBridge(): void {
	const g = globalThis as unknown as {
		kbsinkHTTPRoundTrip?: (json: string) => string;
	};
	g.kbsinkHTTPRoundTrip = kbsinkHttpRoundTripSyncCurl;
}

/** Remove host hook (e.g. on plugin unload). */
export function removeKbsinkHostHTTPBridge(): void {
	const g = globalThis as unknown as { kbsinkHTTPRoundTrip?: unknown };
	delete g.kbsinkHTTPRoundTrip;
}

/** @deprecated Use {@link removeKbsinkHostHTTPBridge}. */
export const removeKbsinkFetchBridge = removeKbsinkHostHTTPBridge;

/**
 * Load arbitrary JS by path. We intentionally do not use `createRequire` from
 * Node's `module` package: `require("module")` fails in some Obsidian/Electron
 * plugin contexts and prevents the plugin from loading at all.
 */
function requireScript(absPath: string): void {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	require(absPath);
}

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
	installKbsinkHostHTTPBridge();
	installKbsinkLogBridge();
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
		requireScript(wasmExec);

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

export interface KbsinkWasmConvertRequest {
	url: string;
	plugin?: string;
	videoMode?: string;
	timeoutMs?: number;
	outputRoot?: string;
}

export function kbsinkWasmConvertJSON(payload: KbsinkWasmConvertRequest): WasmConvertResponse {
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
