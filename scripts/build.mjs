/**
 * Build: transpiles src/index.ts -> lib/index.js (host, ESM) and
 * src/client.ts -> lib/client.js (browser bundle served through the
 * `dsh.client` manifest as a `window.__ModuleLoader__.load({...})` wrapper).
 *
 * Usage: node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScript() {
	const require = createRequire(import.meta.url);
	const candidates = [
		process.env.DSH_TYPESCRIPT_PATH,
		"typescript",
		`${process.env.HOME}/easy-coder/node_modules/typescript`,
		`${process.env.HOME}/.dsh/runtime/node_modules/typescript`
	];
	for (const id of candidates) {
		if (!id) continue;
		try {
			return require(id);
		} catch {}
	}
	throw new Error("typescript not found; install dev dependencies or set DSH_TYPESCRIPT_PATH to an existing compiler");
}

const ts = loadTypeScript();

function transpile({ input, output, module, validate }) {
	const source = readFileSync(resolve(root, input), "utf8");
	const result = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2020,
			module,
			removeComments: false,
			newLine: ts.NewLineKind.LineFeed
		},
		fileName: input,
		reportDiagnostics: true
	});
	const errors = (result.diagnostics ?? []).filter((d) => d.category === 1);
	if (errors.length > 0) {
		for (const d of errors) {
			console.error("error:", ts.flattenDiagnosticMessageText(d.messageText, " "));
		}
		process.exit(1);
	}
	validate?.(result.outputText);
	writeFileSync(resolve(root, output), result.outputText);
	console.log(`built ${input} -> ${output} (${result.outputText.length} bytes)`);
}

mkdirSync(resolve(root, "lib"), { recursive: true });

transpile({
	input: "src/index.ts",
	output: "lib/index.js",
	module: ts.ModuleKind.ES2020
});

// Keep the proxy-aware runtime transport reproducible from source.
writeFileSync(resolve(root, "lib/proxy-fetch.mjs"), readFileSync(resolve(root, "src/proxy-fetch.mjs")));

// The host imports ./vendor/schemastery.mjs relative to lib/ at runtime —
// mirror the vendored files next to the build output (same as balance-panel).
mkdirSync(resolve(root, "lib/vendor"), { recursive: true });
for (const file of ["schemastery.mjs", "cosmokit.js"]) {
	writeFileSync(resolve(root, "lib/vendor", file), readFileSync(resolve(root, "src/vendor", file)));
}

transpile({
	input: "src/client.ts",
	output: "lib/client.js",
	module: ts.ModuleKind.None,
	validate: (output) => {
		const expectedId = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).name;
		const loaderId = output.match(/__ModuleLoader__\.load\s*\(\s*\{\s*id\s*:\s*["']([^"']+)["']/)?.[1];
		if (loaderId !== expectedId) {
			throw new Error(`client ModuleLoader identity must be ${expectedId}, got ${loaderId ?? "no wrapper"} — refusing to write`);
		}
	}
});
