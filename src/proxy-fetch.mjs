/**
 * dsh-codex-auth — proxy-aware fetch for the OpenAI token endpoints.
 *
 * Why: Node's built-in fetch never reads the OS/system proxy configuration,
 * so in regions where OpenAI is blocked the token exchange fails with 403
 * unsupported_country_region_territory even when a system proxy (Clash 等)
 * is running and the browser works fine.
 *
 * Strategy (cached after the first successful attempt):
 *   1. explicit env proxies (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY)
 *   2. well-known local proxy ports (Clash 7897/7890, V2Ray 1087 …)
 *   3. direct connection (no proxy)
 *
 * The request itself is issued as raw HTTP/1.1 over a TLS socket whose
 * underlying connection tunnels through the proxy with HTTP CONNECT.
 * Response parsing supports Content-Length, chunked and close-delimited
 * bodies — enough for the small JSON payloads these endpoints return.
 *
 * Zero runtime dependencies.
 */
import http from 'node:http';
import tls from 'node:tls';

const WELL_KNOWN_PORTS = [7897, 7890, 1087, 8118, 6152, 1080];
const PROBE_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 30000;

const cache = { proxy: undefined }; // undefined = 未探测；null = 直连可用；string = 可用代理

function candidateProxies() {
    const list = [];
    for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
        const v = process.env[key];
        if (v && /^https?:\/\//i.test(v)) list.push(v.replace(/\/+$/, ''));
    }
    for (const port of WELL_KNOWN_PORTS) list.push(`http://127.0.0.1:${port}`);
    return [...new Set(list)];
}

/** 通过代理发起 CONNECT，返回到目标 host:port 的原始 TCP socket。 */
function connectViaProxy(proxyUrl, host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(proxyUrl); } catch (e) { reject(new Error(`bad proxy url: ${proxyUrl}`)); return; }
        const req = http.request({
            host: u.hostname,
            port: Number(u.port || 80),
            method: 'CONNECT',
            path: `${host}:${port}`,
            headers: { host: `${host}:${port}` },
            timeout: timeoutMs,
        });
        req.on('connect', (res, socket) => {
            if (res.statusCode === 200) resolve(socket);
            else { socket.destroy(); reject(new Error(`proxy CONNECT ${res.statusCode}`)); }
        });
        req.on('timeout', () => { req.destroy(new Error('proxy connect timeout')); });
        req.on('error', reject);
        req.end();
    });
}

/** 在已建立的 TLS socket 上发送请求并收集完整响应。 */
function requestOverSocket(socket, url, { method = 'POST', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
        // Node fetch 允许 body 为 URLSearchParams；原始请求需要字符串
        if (body && typeof body === 'object' && typeof body.toString === 'function' && !Buffer.isBuffer(body)) {
            body = body.toString();
        }
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error('request timeout'));
        }, REQUEST_TIMEOUT_MS);
        const head = [
            `${method} ${url.pathname}${url.search} HTTP/1.1`,
            `host: ${url.host}`,
            'connection: close',
            ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        ];
        if (body) head.push(`content-length: ${Buffer.byteLength(body)}`);
        socket.write(head.join('\r\n') + '\r\n\r\n' + (body || ''));
        const chunks = [];
        socket.on('data', (c) => chunks.push(c));
        socket.on('error', (e) => { clearTimeout(timeout); reject(e); });
        socket.on('close', () => {
            clearTimeout(timeout);
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                const sep = raw.indexOf('\r\n\r\n');
                if (sep === -1) { reject(new Error('malformed proxy response')); return; }
                const headText = raw.slice(0, sep);
                let bodyText = raw.slice(sep + 4);
                const statusLine = headText.split('\r\n')[0] || '';
                const status = Number(statusLine.split(' ')[1]) || 0;
                if (/transfer-encoding:\s*chunked/i.test(headText)) bodyText = dechunk(bodyText);
                resolve({
                    status,
                    ok: status >= 200 && status < 300,
                    text: async () => bodyText,
                    json: async () => JSON.parse(bodyText),
                });
            } catch (e) { reject(e); }
        });
    });
}

function dechunk(text) {
    let out = '';
    let rest = text;
    for (;;) {
        const idx = rest.indexOf('\r\n');
        if (idx === -1) break;
        const size = parseInt(rest.slice(0, idx), 16);
        if (!Number.isFinite(size) || size === 0) break;
        out += rest.slice(idx + 2, idx + 2 + size);
        rest = rest.slice(idx + 2 + size + 2);
    }
    return out;
}

/**
 * 代理感知的 fetch（覆盖本插件用到的 Response 子集：ok / status / text / json）。
 * 首次调用时按候选顺序探测并缓存可用的出口（代理或直连）。
 */
export async function proxyFetch(url, options = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('proxyFetch only supports https');
    const port = Number(u.port || 443);
    const candidates = [];
    if (cache.proxy !== undefined) candidates.push(cache.proxy); // 已知可用出口优先
    else candidates.push(...candidateProxies(), null);
    let lastError;
    for (const proxy of candidates) {
        try {
            let socket;
            if (proxy) {
                const raw = await connectViaProxy(proxy, u.hostname, port, PROBE_TIMEOUT_MS);
                // 隧道 socket 上再包一层 TLS（目标是 https）
                socket = tls.connect({ socket: raw, host: u.hostname, port, servername: u.hostname });
                await new Promise((resolve, reject) => {
                    socket.once('secureConnect', resolve);
                    socket.once('error', reject);
                    setTimeout(() => { socket.destroy(); reject(new Error('tls handshake timeout')); }, PROBE_TIMEOUT_MS);
                });
            } else {
                socket = tls.connect({ host: u.hostname, port, servername: u.hostname });
                await new Promise((resolve, reject) => {
                    socket.once('secureConnect', resolve);
                    socket.once('error', reject);
                    setTimeout(() => { socket.destroy(); reject(new Error('direct connect timeout')); }, PROBE_TIMEOUT_MS);
                });
            }
            const res = await requestOverSocket(socket, u, options);
            cache.proxy = proxy; // 记住可用出口
            return res;
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'all connection attempts failed'));
}
