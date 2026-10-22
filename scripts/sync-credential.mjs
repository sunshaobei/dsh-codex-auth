#!/usr/bin/env node
/**
 * sync-credential.mjs — 把 pi-ai CLI 登录产物（auth.json 里的 openai-codex
 * OAuth 凭证）同步进 DSH 客户端凭证库 ~/.dsh/.credentials.yaml 的
 * `llm-pi-ai/openai-codex` grant 记录。
 *
 * 用途：当插件内 OAuth（或 CLI）任一路径拿到新凭证后，保证客户端读到的是
 * 最新 token。幂等：相同 expires 则跳过。
 *
 * 用法：node scripts/sync-credential.mjs [auth.json 路径]
 *   默认 auth.json 路径 = ~/.dsh/auth.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let yaml;
try {
	yaml = require('js-yaml');
} catch {
	yaml = require('/tmp/asar-x/node_modules/js-yaml');
}

const authFile = process.argv[2] ?? path.join(os.homedir(), '.dsh', 'auth.json');
const credFile = path.join(os.homedir(), '.dsh', '.credentials.yaml');
const KEY = 'llm-pi-ai/openai-codex';

const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
const cred = auth['openai-codex'];
if (!cred || cred.type !== 'oauth' || !cred.access) {
	console.error(`no openai-codex oauth credential in ${authFile}`);
	process.exit(1);
}

fs.chmodSync(credFile, 0o600); // ensure writable by owner even if a prior write flipped perms
const doc = yaml.load(fs.readFileSync(credFile, 'utf8')) ?? {};
doc.records = doc.records ?? {};
const current = doc.records[KEY];
if (current?.kind === 'grant' && current.payload?.expires >= cred.expires) {
	console.log('up-to-date, skip (expires', current.payload.expires, '>=', cred.expires + ')');
	process.exit(0);
}
doc.records[KEY] = {
	kind: 'grant',
	payload: {
		type: 'oauth',
		access: cred.access,
		refresh: cred.refresh,
		expires: cred.expires,
		accountId: cred.accountId,
	},
};
fs.writeFileSync(credFile, yaml.dump(doc, { sortKeys: false, lineWidth: -1 }), { mode: 0o600 });
console.log('synced. expires:', new Date(cred.expires).toISOString(), 'accountId:', cred.accountId);
