#!/usr/bin/env node
/**
 * Clean dist/, run tsc, copy manifest + wasm (and optional styles.css) for Obsidian publish.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const wasmSrc = path.join(root, "wasm");
const wasmDst = path.join(dist, "wasm");

fs.rmSync(dist, { recursive: true, force: true });

execSync("npx tsc -p .", { stdio: "inherit", cwd: root });

fs.mkdirSync(wasmDst, { recursive: true });
fs.copyFileSync(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));

const wasmFiles = ["wasm_exec.js", "kbsink.wasm"];
let missing = false;
for (const name of wasmFiles) {
	const s = path.join(wasmSrc, name);
	const d = path.join(wasmDst, name);
	if (!fs.existsSync(s)) {
		console.warn(`prepare-dist: missing ${path.relative(root, s)} (add wasm/ or run wasm:pull)`);
		missing = true;
		continue;
	}
	fs.copyFileSync(s, d);
}

const css = path.join(root, "styles.css");
if (fs.existsSync(css)) {
	fs.copyFileSync(css, path.join(dist, "styles.css"));
}

const requiredJs = ["main.js", "kbsink-wasm.js"];
for (const name of requiredJs) {
	const p = path.join(dist, name);
	if (!fs.existsSync(p)) {
		console.error(`prepare-dist: missing ${name} in dist/`);
		process.exit(1);
	}
}
const mainJs = fs.readFileSync(path.join(dist, "main.js"), "utf8");
if (mainJs.includes('require("./i18n")') || mainJs.includes("require('./i18n')")) {
	console.error("prepare-dist: main.js still requires ./i18n — merge i18n into main.ts");
	process.exit(1);
}

if (missing) {
	console.warn("dist/ built but wasm is incomplete; plugin will not load kbsink until wasm is present.");
}
console.log(`dist/ ready → ${dist}`);
