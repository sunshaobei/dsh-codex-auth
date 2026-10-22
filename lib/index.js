/**
 * dsh-codex-auth — Codex 订阅授权管理 for the dsh web surface.
 *
 * Dual-face plugin:
 *
 *  - Host half (lib/index.js, zero runtime deps — schemastery vendored):
 *      - `status`  → reads the `llm-pi-ai/openai-codex` grant record from
 *        ctx.credentials and reports {configured, expired, expires,
 *        accountId, plan, email} (plan/email decoded from the access JWT).
 *      - `login`   → runs the full OpenAI OAuth browser flow host-side:
 *        PKCE S256 → local callback server on 127.0.0.1:1455 (same port the
 *        Codex CLI uses) → opens the system browser → exchanges the code →
 *        writes the grant record via ctx.credentials.modifyRecord (which
 *        also fires credentials/record-updated so the model catalog
 *        refreshes without a restart).
 *      - `logout`  → deletes the grant record.
 *
 *  - Client half (lib/client.js, served at /plugins/dsh-codex-auth/client.js):
 *      - a `settings.section` page "Codex 订阅": authorization status,
 *        validity/expiry display, authorize/re-authorize/logout buttons.
 *      - a `shell.overlay` modal: when the active session's selected model
 *        routes to openai-codex and the credential is expired, an
 *        authorization prompt pops up (dismissible, snoozes 10 minutes).
 *
 * OAuth constants mirror @earendil-works/pi-ai's openai-codex adapter
 * (CLIENT_ID app_EMoamEEZ73f0CkXaXp7hrann, PKCE S256, scope
 * openid profile email offline_access, codex_cli_simplified_flow=true).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import z from './vendor/schemastery.mjs';
const RPC_CHANNEL = '/dsh-codex-auth';
const CRED_KEY = 'llm-pi-ai/openai-codex';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_BASE = 'https://auth.openai.com';
const AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
export const name = 'codex-auth';
export const inject = ['connection', 'credentials', 'webServer', 'llm', 'settings'];
export const Config = z.object({}).i18n({});
// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function b64urlToJson(segment) {
    try {
        const json = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        return JSON.parse(json);
    }
    catch {
        return undefined;
    }
}
function decodeJwtPayload(accessToken) {
    const parts = String(accessToken || '').split('.');
    return parts.length >= 2 ? b64urlToJson(parts[1]) : undefined;
}
/** Best-effort status read; never throws for the UI. */
async function readStatus(credentials) {
    try {
        const record = await credentials.readRecord(CRED_KEY);
        const payload = record && record.kind === 'grant' ? record.payload : undefined;
        if (!payload || payload.type !== 'oauth' || !payload.access) {
            return { configured: false };
        }
        const expires = typeof payload.expires === 'number' ? payload.expires : 0;
        const claims = decodeJwtPayload(payload.access) ?? {};
        const auth = claims['https://api.openai.com/auth'] ?? {};
        const profile = claims['https://api.openai.com/profile'] ?? {};
        return {
            configured: true,
            expires,
            expired: expires > 0 && expires <= Date.now(),
            msLeft: expires > 0 ? expires - Date.now() : 0,
            accountId: typeof payload.accountId === 'string' ? payload.accountId : (auth.chatgpt_account_id ?? undefined),
            plan: auth.chatgpt_plan_type ?? undefined,
            email: profile.email ?? undefined,
        };
    }
    catch (error) {
        return { configured: false, error: String(error) };
    }
}
function pkcePair() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}
function openBrowser(url) {
    return new Promise((resolve, reject) => {
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
        const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
        execFile(command, args, (error) => error ? reject(error) : resolve());
    });
}
function exchangeCode(code, verifier) {
    return fetch(TOKEN_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: REDIRECT_URI,
        }),
    });
}
function callbackPage(error) {
    const escape = (text) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${error ? '授权未完成' : '授权成功'} · DeepSeek Harness</title>
<style>
:root{color-scheme:light dark;--bg:#f7f8fa;--surface:#fff;--text:#1b1b1f;--muted:#737780;--line:#e9ebef;--blue:#4d6bfe;--soft:#eef2ff;--error:#c34343;--error-bg:#fff1f0}
*{box-sizing:border-box}body{margin:0;min-height:100svh;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
header{padding:30px 40px;display:flex;align-items:center;gap:12px}.brand{font-size:25px;font-weight:700;letter-spacing:-1px;color:var(--blue)}.brand-tag{font-size:10px;font-weight:650;letter-spacing:1.6px;border-left:1px solid var(--line);padding-left:12px;color:var(--muted)}
main{flex:1;display:grid;place-items:center;padding:32px 24px 90px}.card{width:100%;max-width:460px;padding:42px 36px 30px;background:var(--surface);border:1px solid var(--line);border-radius:24px;text-align:center;box-shadow:0 8px 40px #18265505}
.status-icon{width:64px;height:64px;border-radius:22px;background:var(--soft);color:var(--blue);display:grid;place-items:center;margin:0 auto 24px}.status-icon.error{background:var(--error-bg);color:var(--error)}
.eyebrow{font-size:12px;color:var(--muted);letter-spacing:.5px;margin:0 0 10px}h1{font-size:26px;line-height:1.4;font-weight:600;letter-spacing:-.6px;margin:0 0 12px}.description{font-size:14px;line-height:1.8;color:var(--muted);margin:0 auto 28px;overflow-wrap:anywhere}
.button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:46px;padding:12px 20px;border-radius:12px;background:var(--blue);color:white;text-decoration:none;font-size:14px;font-weight:500;transition:background .15s,transform .15s}.button:hover{background:#3b58ed}.button:active{transform:translateY(1px)}.button:focus-visible{outline:3px solid #a9b7ff;outline-offset:4px}
.hint{margin:16px 0 0;color:var(--muted);font-size:12px;line-height:1.7}.footnote{border-top:1px solid var(--line);margin:28px 0 0;padding-top:20px;color:var(--muted);font-size:12px;line-height:1.7}footer{text-align:center;padding:0 24px 24px;color:var(--muted);font-size:11px}
@media(prefers-color-scheme:dark){:root{--bg:#191a1d;--surface:#232428;--text:#ececf0;--muted:#a0a2aa;--line:#34353a;--soft:#2b3356;--error:#ff9993;--error-bg:#422b2c}.card{box-shadow:none}}
@media(max-width:480px){header{padding:24px}.card{padding:32px 24px;border-radius:20px}main{padding:16px 20px 48px}h1{font-size:24px}}
</style></head><body>
<header aria-label="DeepSeek Harness"><span class="brand">deepseek</span><span class="brand-tag">HARNESS</span></header>
<main><section class="card" aria-labelledby="title"><div class="status-icon ${error ? 'error' : ''}"><svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${error ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>' : '<path d="m5 12 4 4L19 6"/>'}</svg></div>
<p class="eyebrow">Codex 订阅 · ChatGPT 授权</p><h1 id="title">${error ? '授权未完成' : '授权成功，准备就绪'}</h1>
<p class="description">${error ? escape(error) : '凭证已保存。<br>返回 DeepSeek Harness，继续你的工作。'}</p>
<a class="button" href="dsh://open">返回 DeepSeek Harness <span aria-hidden="true">↗</span></a>
<p class="hint">${error ? '返回应用后，可查看状态并重新授权。' : '若浏览器询问是否打开应用，请选择「打开」。'}</p>
<p class="footnote">${error ? '本次授权未完成，请在应用内重试。' : '授权凭证仅保存在本机。<br>返回应用后，可以关闭此页面。'}</p></section></main><footer>DeepSeek Harness · Codex 订阅连接</footer>
<script>history.replaceState(null,'','/auth/callback');${error ? '' : 'setTimeout(()=>{location.href="dsh://open"},500);'}</script></body></html>`;
}
// ---------------------------------------------------------------------------
// OAuth browser flow (one at a time, owned by the host process)
// ---------------------------------------------------------------------------
function runBrowserLogin(credentials, phase) {
    if (phase.phase === 'waiting' || phase.phase === 'exchanging') {
        return Promise.resolve({ phase: phase.phase });
    }
    phase.phase = 'waiting';
    phase.error = undefined;
    phase.startedAt = Date.now();
    return new Promise((resolve) => {
        const { verifier, challenge } = pkcePair();
        const state = crypto.randomBytes(16).toString('hex');
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', CLIENT_ID);
        url.searchParams.set('redirect_uri', REDIRECT_URI);
        url.searchParams.set('scope', SCOPE);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('id_token_add_organizations', 'true');
        url.searchParams.set('codex_cli_simplified_flow', 'true');
        url.searchParams.set('originator', 'pi');
        let server;
        let settled = false;
        const finish = async (fn) => {
            if (settled)
                return;
            settled = true;
            phase.cancel = undefined;
            clearTimeout(timer);
            try {
                server?.close();
            }
            catch { }
            try {
                const result = await fn();
                resolve(result);
            }
            catch (error) {
                phase.phase = 'error';
                phase.error = error instanceof Error ? error.message : String(error);
                resolve({ phase: 'error', error: phase.error });
            }
        };
        phase.cancel = () => finish(async () => {
            phase.phase = 'idle';
            phase.error = undefined;
            return { phase: 'idle' };
        });
        const timer = setTimeout(() => {
            finish(async () => { throw new Error('授权超时：5 分钟内未收到浏览器回调'); });
        }, LOGIN_TIMEOUT_MS);
        server = http.createServer((req, res) => {
            const parsed = new URL(req.url ?? '/', 'http://localhost:1455');
            if (parsed.pathname !== '/auth/callback') {
                res.writeHead(404).end('not found');
                return;
            }
            const error = parsed.searchParams.get('error');
            const code = parsed.searchParams.get('code');
            const returnedState = parsed.searchParams.get('state');
            if (settled) {
                res.writeHead(409).end('Authorization already processing');
                return;
            }
            const reply = (error) => res.writeHead(error ? 400 : 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end(callbackPage(error));
            if (returnedState !== state) {
                reply('回调参数无效（state 不匹配），请返回原授权页面重试。');
                return;
            }
            if (error) {
                const message = `授权被拒绝: ${error}`;
                reply(message);
                finish(async () => { throw new Error(message); });
                return;
            }
            if (!code || returnedState !== state) {
                reply('回调参数无效（code/state 不匹配），请返回原授权页面重试。');
                return;
            }
            phase.phase = 'exchanging';
            finish(async () => {
                try {
                    const response = await exchangeCode(code, verifier);
                    const json = await response.json().catch(() => ({}));
                    if (!response.ok || !json.access_token || !json.refresh_token || !Number.isFinite(Number(json.expires_in)) || Number(json.expires_in) <= 0) {
                        throw new Error(`token 交换失败 (${response.status}): ${typeof json.error === 'string' ? json.error : '响应缺少有效凭证'}`);
                    }
                    const access = json.access_token;
                    const claims = decodeJwtPayload(access) ?? {};
                    const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
                    if (typeof accountId !== 'string' || accountId.length === 0) {
                        throw new Error('无法从 access token 中解析 accountId');
                    }
                    const payload = {
                        type: 'oauth',
                        access,
                        refresh: json.refresh_token,
                        expires: Date.now() + Number(json.expires_in ?? 0) * 1000,
                        accountId,
                    };
                    await credentials.modifyRecord(CRED_KEY, async () => ({ kind: 'grant', payload }));
                    const status = await readStatus(credentials);
                    if (!status.configured || status.expired)
                        throw new Error('凭证写入后校验失败');
                    phase.phase = 'done';
                    reply();
                    return { phase: 'done', status };
                }
                catch (error) {
                    reply(error instanceof Error ? error.message : String(error));
                    throw error;
                }
            });
        });
        server.on('error', (error) => {
            finish(async () => {
                throw new Error(error.code === 'EADDRINUSE'
                    ? '本地回调端口 1455 被占用（可能是 Codex CLI 正在登录）。请先结束占用进程后重试。'
                    : `回调服务启动失败: ${error.message}`);
            });
        });
        server.listen(1455, '127.0.0.1', () => {
            openBrowser(url.toString()).catch((error) => {
                finish(async () => { throw new Error(`无法打开浏览器: ${String(error)}`); });
            });
        });
    });
}
// ---------------------------------------------------------------------------
// loopback RPC channel (same shape as dsh-balance-panel)
// ---------------------------------------------------------------------------
function rpcFailure(rpcId, code, message) {
    return { type: 'server-response', rpcId, result: { ok: false, error: { code, message, details: {} } } };
}
// Activate the installed catalog route through the host settings service.
// Never replace existing provider options or hardcode a model catalog.
async function ensureCodexModels(ctx) {
    const provider = 'openai-codex';
    try {
        if (!ctx.llm || !ctx.settings)
            throw new Error('模型或设置服务尚未就绪，请稍后刷新');
        const entry = (await ctx.llm.listConfigurableProviders()).find((row) => row.provider === provider);
        if (!entry)
            throw new Error('当前宿主未安装 Codex 模型目录，请检查 llm-pi-ai 插件');
        const document = (await ctx.settings.describe()).find((row) => row.ns === entry.settingsNs);
        if (!document)
            throw new Error('无法读取 Codex 提供商配置');
        const current = entry.settingsPath.reduce((value, key) => value?.[key], document.value);
        if (current === undefined) {
            await ctx.settings.mutate(entry.settingsNs, [{ op: 'set', path: entry.settingsPath, value: { displayName: 'Codex (ChatGPT)' } }], document.revision);
        }
        const models = await ctx.llm.listModels(provider);
        if (!models.length)
            throw new Error('Codex 模型目录为空，请检查提供商配置后刷新');
        return { ready: true, count: models.length };
    }
    catch (error) {
        return { ready: false, error: error instanceof Error ? error.message : String(error) };
    }
}
function registerCodexAuthRpc(ctx, credentials, phase) {
    let modelSync;
    const statusWithModels = async () => {
        const status = await readStatus(credentials);
        if (!status.configured || status.expired)
            return status;
        modelSync ?? (modelSync = ensureCodexModels(ctx).finally(() => { modelSync = undefined; }));
        return { ...status, models: await modelSync };
    };
    const route = {
        kind: 'prefix',
        path: RPC_CHANNEL,
        handler: async (req, res) => {
            const rejection = typeof ctx.connection?.requestRejection === 'function' ? ctx.connection.requestRejection(req) : undefined;
            if (rejection !== undefined) {
                res.writeHead(rejection);
                res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
                return;
            }
            const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
            if (!pathname.startsWith(`${RPC_CHANNEL}/`)) {
                res.writeHead(404).end('not found');
                return;
            }
            const endpoint = pathname.slice(RPC_CHANNEL.length + 1);
            if (req.method !== 'POST' || !/^[A-Za-z0-9_$.-]+$/.test(endpoint)) {
                res.writeHead(404).end('not found');
                return;
            }
            let message = null;
            try {
                const chunks = [];
                for await (const chunk of req)
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                const text = Buffer.concat(chunks).toString('utf8');
                message = text ? JSON.parse(text) : null;
            }
            catch (error) {
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rpcFailure('invalid-request', 'gateway/bad-request', String(error))));
                return;
            }
            const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request';
            if (message?.type !== 'client-request' || typeof message.method !== 'string' || message.method !== endpoint) {
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rpcFailure(rpcId, 'gateway/bad-request', 'invalid client-request message')));
                return;
            }
            try {
                let result;
                if (endpoint === 'status') {
                    result = { status: await statusWithModels(), login: { phase: phase.phase, error: phase.error } };
                }
                else if (endpoint === 'login') {
                    void runBrowserLogin(credentials, phase);
                    result = { phase: phase.phase };
                    if (result.phase === 'done')
                        result.status = await readStatus(credentials);
                    result.login = { phase: phase.phase, error: phase.error };
                }
                else if (endpoint === 'cancel') {
                    if (phase.phase === 'exchanging')
                        throw new Error('正在保存授权，请稍候');
                    await phase.cancel?.();
                    result = { status: await readStatus(credentials), login: { phase: phase.phase, error: phase.error } };
                }
                else if (endpoint === 'logout') {
                    if (phase.phase === 'waiting' || phase.phase === 'exchanging')
                        throw new Error('授权进行中，请完成后再取消授权');
                    await credentials.deleteRecord(CRED_KEY);
                    phase.phase = 'idle';
                    phase.error = undefined;
                    result = { status: await statusWithModels(), login: { phase: phase.phase } };
                }
                else {
                    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rpcFailure(rpcId, 'gateway/no-endpoint', `unknown endpoint ${endpoint}`)));
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: result } }));
            }
            catch (error) {
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rpcFailure(rpcId, 'gateway/handler', error instanceof Error ? error.message : String(error))));
            }
        }
    };
    ctx.effect(() => ctx.webServer.register(route), 'dsh-codex-auth: rpc channel');
}
// ---------------------------------------------------------------------------
// silent token refresh (runs once per app start; no timers)
// ---------------------------------------------------------------------------

async function silentRefresh(credentials) {
    try {
        const record = await credentials.readRecord(CRED_KEY);
        const payload = record && record.kind === 'grant' ? record.payload : undefined;
        if (!payload || payload.type !== 'oauth' || !payload.refresh)
            return;
        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            signal: AbortSignal.timeout(30000),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: CLIENT_ID,
                refresh_token: payload.refresh,
            }),
        });
        if (!res.ok)
            return; // keep the old grant; user can re-authorize if it expires
        const json = await res.json().catch(() => undefined);
        if (!json || typeof json.access_token !== 'string' || json.access_token.length === 0)
            return;
        const next = {
            ...payload,
            access: json.access_token,
            refresh: typeof json.refresh_token === 'string' && json.refresh_token.length > 0 ? json.refresh_token : payload.refresh,
            expires: Date.now() + Number(json.expires_in ?? 0) * 1000,
        };
        if (!(next.expires > Date.now()))
            return;
        await credentials.modifyRecord(CRED_KEY, async () => ({ kind: 'grant', payload: next }));
    }
    catch {
        // silent: keep the old grant on any failure
    }
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------
export function apply(ctx, _config = {}) {
    const credentials = ctx.credentials;
    const phase = { phase: 'idle' };
    registerCodexAuthRpc(ctx, credentials, phase);
    void silentRefresh(credentials);
}
