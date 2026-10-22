/**
 * dsh-codex-auth — client half (browser bundle, served at
 * /plugins/dsh-codex-auth/client.js through the `dsh.client` manifest).
 *
 * Registers:
 *  1. settings.section "codex-subscription" — Codex 订阅 page: status,
 *     expiry, authorize / re-authorize / logout.
 *  2. shell.overlay "codex-auth-expired-modal" — pops the re-auth dialog
 *     when the active session's model routes to openai-codex while the
 *     credential is expired (snoozes 10 minutes on dismiss).
 *
 * Talks to the host half over the loopback Connection RPC channel
 * `/dsh-codex-auth` (status / login / logout).
 */
window.__ModuleLoader__.load({
    id: "@sunshaobei/dsh-codex-auth",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
        var React = require("react");
        var CHANNEL = "/dsh-codex-auth";
        var NS = "codex-auth";
        var PROVIDER = "openai-codex";
        var SNOOZE_MS = 10 * 60 * 1000;
        var DICT = {
            zh: {
                nav: "Codex 订阅",
                title: "Codex 订阅（ChatGPT 授权）",
                desc: "通过 OpenAI OAuth 授权使用 Codex 订阅内的 GPT 模型，无需 API key。凭证保存在本机 ~/.dsh/.credentials.yaml。",
                status: "授权状态",
                active: "已授权",
                expired: "已过期",
                missing: "未授权",
                failed: "授权失败",
                checking: "检查中…",
                account: "授权账号",
                plan: "订阅类型",
                validUntil: "有效期至",
                expiredAt: "已于 {time} 过期",
                leftDays: "{days} 天后过期",
                leftHours: "{hours} 小时后过期",
                authorize: "授权 Codex",
                reauthorize: "重新授权",
                logout: "取消授权",
                waitingBrowser: "已打开浏览器，等待授权完成…（最多 5 分钟）",
                loginDone: "授权成功",
                modelsReady: "已添加 {count} 个 Codex 模型，可在会话中选择",
                modelsFailed: "授权已保存，模型添加失败：{error}",
                loginFailed: "授权失败：{error}",
                logoutFailed: "取消授权失败：{error}",
                loadFailed: "无法读取授权状态",
                neverUsed: "尚未授权过",
                modalTitle: "Codex 授权已过期",
                modalBody: "当前会话使用的 GPT 模型依赖 Codex 订阅授权，授权已于 {time} 过期。重新授权后即可继续使用。",
                modalAuthorize: "重新授权",
                modalLater: "稍后再说",
                cancelLogin: "取消本次登录",
                browserHelp: "如果浏览器显示 403 或验证失败，本应用无法读取该页面错误。可取消本次登录后重试；已有授权会保留。",
                authorizing: "授权中…"
            },
            en: {
                nav: "Codex Subscription",
                title: "Codex Subscription (ChatGPT OAuth)",
                desc: "Use the GPT models included in your Codex subscription via OpenAI OAuth — no API key required. The credential is stored locally in ~/.dsh/.credentials.yaml.",
                status: "Status",
                active: "Authorized",
                expired: "Expired",
                missing: "Not authorized",
                failed: "Authorization failed",
                checking: "Checking…",
                account: "Account",
                plan: "Plan",
                validUntil: "Valid until",
                expiredAt: "Expired at {time}",
                leftDays: "Expires in {days} days",
                leftHours: "Expires in {hours} h",
                authorize: "Authorize Codex",
                reauthorize: "Re-authorize",
                logout: "Sign out",
                waitingBrowser: "Browser opened — waiting for authorization… (up to 5 min)",
                loginDone: "Authorized",
                modelsReady: "{count} Codex models are ready to select",
                modelsFailed: "Authorized, but model setup failed: {error}",
                loginFailed: "Authorization failed: {error}",
                logoutFailed: "Sign out failed: {error}",
                loadFailed: "Cannot read authorization status",
                neverUsed: "Never authorized",
                modalTitle: "Codex authorization expired",
                modalBody: "The GPT model of this session relies on your Codex subscription authorization, which expired at {time}. Re-authorize to continue.",
                modalAuthorize: "Re-authorize",
                modalLater: "Later",
                cancelLogin: "Cancel login",
                browserHelp: "If the browser shows a 403 or verification error, cancel this login and retry. This app cannot read browser errors; your existing authorization is preserved.",
                authorizing: "Authorizing…"
            }
        };
        function fmtTime(ts) {
            if (!ts)
                return "—";
            var d = new Date(ts);
            var pad = function (n) { return (n < 10 ? "0" : "") + n; };
            return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
        }
        function tpl(s, vars) {
            return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
        }
        function statusText(t, st) {
            if (!st || st.configured === undefined)
                return t("checking");
            if (!st.configured)
                return t("missing");
            return st.expired ? t("expired") : t("active");
        }
        function validityText(t, st) {
            if (!st || !st.configured)
                return st && st.configured === false ? t("neverUsed") : "—";
            if (!st.expires)
                return "—";
            if (st.expired)
                return tpl(t("expiredAt"), { time: fmtTime(st.expires) });
            var ms = st.msLeft || 0;
            if (ms > 36 * 3600 * 1000)
                return tpl(t("leftDays"), { days: Math.round(ms / 86400000) }) + "（" + fmtTime(st.expires) + "）";
            return tpl(t("leftHours"), { hours: Math.round(ms / 3600000) }) + "（" + fmtTime(st.expires) + "）";
        }
        // ------------------------------------------------------------------
        // styles (Harness design tokens)
        // ------------------------------------------------------------------
        // OpenAI mark: Simple Icons v14 (CC0), https://github.com/simple-icons/simple-icons/blob/14.0.0/icons/openai.svg
        var CSS = `
.codex-auth-nav > svg{display:none!important}
.codex-auth-nav::before{content:"";display:block;flex:none;width:16px;height:16px;background:currentColor;mask:url("data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+T3BlbkFJPC90aXRsZT48cGF0aCBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg==") center/contain no-repeat;-webkit-mask:url("data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+T3BlbkFJPC90aXRsZT48cGF0aCBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg==") center/contain no-repeat}

.codex-auth-card{border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l2,#ddd));border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px;width:100%;min-width:0;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#fff)}
.codex-auth-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.codex-auth-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
.codex-auth-pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid}
.codex-auth-pill.ok{color:#0a7d38;border-color:#0a7d3855;background:#0a7d3811}
.codex-auth-pill.bad{color:#c62828;border-color:#c6282855;background:#c6282811}
.codex-auth-pill.idle{color:#888;border-color:#88888855;background:#88888811}
.codex-auth-desc{font-size:12px;color:var(--dsw-alias-label-secondary,#666);line-height:1.5}
.codex-auth-grid{display:grid;grid-template-columns:96px minmax(0,1fr);gap:6px 12px;font-size:12.5px}
.codex-auth-grid dt{color:var(--dsw-alias-label-secondary,#666)}
.codex-auth-grid dd{margin:0;color:var(--dsw-alias-label-primary,#111);word-break:break-all}
.codex-auth-actions{display:flex;gap:8px;flex-wrap:wrap}
.codex-auth-btn{border:1px solid var(--dsw-alias-border-l2,#ccc);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:8px;padding:6px 14px;font-size:12.5px;cursor:pointer;color:var(--dsw-alias-label-primary,#111)}
.codex-auth-btn.primary{background:var(--dsw-static-deepseek-500,#4d6bfe);border-color:var(--dsw-static-deepseek-500,#4d6bfe);color:#fff}
.codex-auth-btn.danger{color:#c62828;border-color:#c6282866}
.codex-auth-btn:disabled{opacity:.55;cursor:default}
.codex-auth-msg{overflow-wrap:anywhere;font-size:12px;line-height:1.5}
.codex-auth-msg.err{color:#c62828}
.codex-auth-msg.ok{color:#0a7d38}
.codex-auth-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:grid;place-items:center}
.codex-auth-dialog{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#111);border-radius:14px;box-shadow:var(--dsw-shadow-modal,0 12px 40px rgba(0,0,0,.3));padding:22px;width:400px;max-width:90vw;display:flex;flex-direction:column;gap:12px}
.codex-auth-dialog h3{margin:0;font-size:15px}
.codex-auth-dialog p{margin:0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#555)}
.codex-auth-dialog .codex-auth-actions{justify-content:flex-end}
`;
        // ------------------------------------------------------------------
        // shared stores (module scope so both slots see the same state)
        // ------------------------------------------------------------------
        var loginStore = { phase: "idle", error: "", listeners: new Set() };
        function updateLogin(login) {
            if (!login)
                return;
            Object.assign(loginStore, login);
            loginStore.listeners.forEach(l => l());
            setModal({ busy: login.phase === "waiting" || login.phase === "exchanging" });
            if (login.phase === "done")
                setModal({ open: false });
        }
        var statusStore = { value: null, listeners: new Set() };
        function setStatus(v) {
            statusStore.value = v;
            statusStore.listeners.forEach((l) => l(v));
        }
        var modalStore = { open: false, busy: false, listeners: new Set() };
        function setModal(patch) {
            Object.assign(modalStore, patch);
            modalStore.listeners.forEach((l) => l(modalStore));
        }
        var snoozedUntil = 0;
        function useStore(store) {
            var [, force] = React.useReducer((n) => n + 1, 0);
            React.useEffect(() => {
                var l = () => force();
                store.listeners.add(l);
                return () => { store.listeners.delete(l); };
            }, [store]);
            return store;
        }
        // ------------------------------------------------------------------
        // components
        // ------------------------------------------------------------------
        function StatusCard(props) {
            var t = props.t;
            var call = props.call;
            var st = useStore(statusStore).value;
            var [msg, setMsg] = React.useState(null);
            var [busy, setBusy] = React.useState("");
            var login = useStore(loginStore);
            var pending = login.phase === "waiting" || login.phase === "exchanging";
            var refresh = React.useCallback(() => {
                call("status", null).then(() => setMsg(null)).catch((e) => setMsg({ kind: "err", text: String(e.message || e) }));
            }, [call]);
            React.useEffect(() => { refresh(); }, [refresh]);
            var authorize = React.useCallback(() => {
                setMsg(null);
                updateLogin({ phase: "waiting", error: "" });
                call("login", null).catch((e) => updateLogin({ phase: "error", error: String(e.message || e) }));
            }, [call]);
            var loginMessage = pending ? { kind: "wait", text: login.phase === "exchanging" ? "正在验证并保存凭证…" : t("waitingBrowser") }
                : login.phase === "error" ? { kind: "err", text: tpl(t("loginFailed"), { error: login.error }) }
                    : login.phase === "done" ? { kind: "ok", text: t("loginDone") } : null;
            msg = msg || loginMessage;
            var logout = React.useCallback(() => {
                setBusy("logout");
                call("logout", null).then((r) => {
                    setBusy("");
                    if (r && r.status)
                        setStatus(r.status);
                    setMsg(null);
                }).catch((e) => {
                    setBusy("");
                    setMsg({ kind: "err", text: tpl(t("logoutFailed"), { error: String(e && e.message || e) }) });
                });
            }, [call, t]);
            var configured = !!(st && st.configured);
            var expired = !!(st && st.expired);
            var pillClass = !st || st.configured === undefined ? "idle" : !configured ? "idle" : expired ? "bad" : "ok";
            return React.createElement("div", { className: "codex-auth-card" }, React.createElement("div", { className: "codex-auth-head" }, React.createElement("span", { className: "codex-auth-title" }, t("title")), React.createElement("span", { className: "codex-auth-pill " + pillClass }, pending ? t("authorizing") : login.phase === "error" ? t("failed") : statusText(t, st))), React.createElement("div", { className: "codex-auth-desc" }, t("desc")), React.createElement("dl", { className: "codex-auth-grid" }, React.createElement("dt", null, t("status")), React.createElement("dd", null, statusText(t, st)), React.createElement("dt", null, t("validUntil")), React.createElement("dd", null, validityText(t, st)), st && st.email ? React.createElement("dt", null, t("account")) : null, st && st.email ? React.createElement("dd", null, st.email + (st.accountId ? " · " + st.accountId.slice(0, 8) : "")) : null, st && st.plan ? React.createElement("dt", null, t("plan")) : null, st && st.plan ? React.createElement("dd", null, String(st.plan).toUpperCase()) : null), React.createElement("div", { className: "codex-auth-actions" }, React.createElement("button", { className: "codex-auth-btn primary", type: "button", disabled: busy !== "" || pending, onClick: authorize }, pending ? t("authorizing") : configured ? t("reauthorize") : t("authorize")), pending ? React.createElement("button", { className: "codex-auth-btn", type: "button", disabled: login.phase === "exchanging", onClick: () => {
                    call("cancel", null).then(() => setMsg(null)).catch((e) => setMsg({ kind: "err", text: String(e.message || e) }));
                } }, t("cancelLogin")) : null, configured ? React.createElement("button", { className: "codex-auth-btn danger", type: "button", disabled: busy !== "" || pending, onClick: logout }, t("logout")) : null), pending ? React.createElement("div", { className: "codex-auth-desc" }, t("browserHelp")) : null, msg ? React.createElement("div", { role: "status", "aria-live": "polite", className: "codex-auth-msg " + (msg.kind === "err" ? "err" : msg.kind === "ok" ? "ok" : "") }, msg.text) : null, st && st.models ? React.createElement("div", { role: "status", className: "codex-auth-msg " + (st.models.ready ? "ok" : "err") }, st.models.ready ? tpl(t("modelsReady"), { count: st.models.count }) : tpl(t("modelsFailed"), { error: st.models.error })) : null, st && st.error ? React.createElement("div", { className: "codex-auth-msg err" }, t("loadFailed") + ": " + String(st.error)) : null, React.createElement("div", { style: { textAlign: "right" } }, React.createElement("button", { className: "codex-auth-btn", type: "button", onClick: refresh, "aria-label": "刷新授权状态" }, "↻")));
        }
        function ExpiredModal(props) {
            var t = props.t;
            var call = props.call;
            var modal = useStore(modalStore);
            var login = useStore(loginStore);
            if (!modal.open)
                return null;
            var st = statusStore.value;
            var authorize = () => {
                updateLogin({ phase: "waiting", error: "" });
                call("login", null).catch((e) => updateLogin({ phase: "error", error: String(e.message || e) }));
            };
            return React.createElement("div", { className: "codex-auth-overlay" }, React.createElement("div", { className: "codex-auth-dialog", role: "dialog", "aria-modal": "true" }, React.createElement("h3", null, t("modalTitle")), login.phase === "error" ? React.createElement("p", { role: "alert", className: "codex-auth-msg err" }, tpl(t("loginFailed"), { error: login.error })) : null, React.createElement("p", null, tpl(t("modalBody"), { time: st && st.expires ? fmtTime(st.expires) : "—" })), React.createElement("div", { className: "codex-auth-actions" }, React.createElement("button", { className: "codex-auth-btn", type: "button", disabled: modal.busy, onClick: () => { snoozedUntil = Date.now() + SNOOZE_MS; setModal({ open: false }); } }, t("modalLater")), React.createElement("button", { className: "codex-auth-btn primary", type: "button", disabled: modal.busy, onClick: authorize }, modal.busy ? t("authorizing") : t("modalAuthorize")))));
        }
        // ------------------------------------------------------------------
        // apply
        // ------------------------------------------------------------------
        const inject = ["slots", "timer", "connection", "locale", "remote"];
        function apply(ctx) {
            var call = async (endpoint, payload) => {
                let timeout;
                try {
                    const result = await Promise.race([
                        ctx.connection.rpc.call(CHANNEL, endpoint, payload),
                        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("连接授权服务超时，请刷新重试")), 12000); })
                    ]);
                    if (!result || result.ok !== true)
                        throw new Error(result?.error?.message || "授权服务返回无效响应");
                    const value = result.value;
                    if (!value || typeof value !== "object" || !value.login || (endpoint !== "login" && typeof value.status?.configured !== "boolean" && !value.status?.error)) {
                        throw new Error("授权服务响应格式不匹配，请重启 DeepSeek Harness 加载新版插件");
                    }
                    if (value.status)
                        setStatus(value.status);
                    updateLogin(value.login);
                    return value;
                }
                finally {
                    clearTimeout(timeout);
                }
            };
            var refreshStatus = function () {
                return call("status", null).catch((e) => {
                    setStatus({ error: String(e.message || e) });
                    if (loginStore.phase === "waiting" || loginStore.phase === "exchanging")
                        updateLogin({ phase: "error", error: String(e.message || e) });
                });
            };
            ctx.effect(function () {
                let stopped = false;
                let timer;
                const poll = async () => {
                    await refreshStatus();
                    if (!stopped)
                        timer = setTimeout(poll, loginStore.phase === "waiting" || loginStore.phase === "exchanging" ? 1000 : 5000);
                };
                const focus = () => { void refreshStatus(); };
                window.addEventListener("focus", focus);
                void poll();
                return () => { stopped = true; clearTimeout(timer); window.removeEventListener("focus", focus); };
            }, "dsh-codex-auth: status polling");
            // Token refresh (by llm-pi-ai) and our own login/logout both touch
            // the same record; the forwarded remote event lets the UI react
            // instantly instead of waiting for the next poll.
            ctx.effect(function () {
                var off = ctx.remote.$on("credentials/record-updated", function (key) {
                    if (String(key).indexOf("openai-codex") > -1)
                        refreshStatus();
                });
                return function () { try {
                    off && off();
                }
                catch (_) { } };
            }, "dsh-codex-auth: record-updated listener");
            ctx.effect(function () {
                var tag = document.createElement("style");
                tag.dataset.plugin = "dsh-codex-auth";
                tag.textContent = CSS;
                document.head.append(tag);
                return function () { tag.remove(); };
            }, "dsh-codex-auth: styles");
            ctx.effect(function () {
                return ctx.locale.register(NS, DICT);
            }, "dsh-codex-auth: dictionaries");
            var t = ctx.locale.bind(NS);
            // The host hardcodes navIcon(id) and exposes no icon slot. Scope the
            // replacement to our own settings navigation button and clean it up.
            ctx.effect(function () {
                const marked = new Set();
                const mark = () => {
                    for (const button of document.querySelectorAll('[data-shortcut-modal="settings"] nav button')) {
                        if (button.textContent?.trim() === t("nav")) {
                            if (!button.classList.contains("codex-auth-nav"))
                                button.classList.add("codex-auth-nav");
                            marked.add(button);
                        }
                    }
                };
                const observer = new MutationObserver(mark);
                observer.observe(document.body, { childList: true, subtree: true });
                mark();
                return () => { observer.disconnect(); marked.forEach(button => button.classList.remove("codex-auth-nav")); };
            }, "dsh-codex-auth: ChatGPT navigation icon");
            // ---- plugin detail page (plugins.bundle.config, same as dsh-context) ----
            const settingsStore = (() => {
                let form; let state = {}; const listeners = new Set();
                const notify = () => listeners.forEach((fn) => fn());
                return {
                    get state() { return state; },
                    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
                    attach(f) { form = f; try { state = { ...state, ...(f && f.get ? f.get() : {}) }; } catch {} notify(); let un; try { un = f.subscribe(() => { try { state = { ...state, ...(f.get ? f.get() : {}) }; } catch {} notify(); }); } catch {} return () => { if (un) un(); if (form === f) form = undefined; }; },
                    set(k, v) { state = { ...state, [k]: v }; notify(); if (form && typeof form.set === "function") form.set(k, v).catch(() => {}); },
                };
            })();
            const registerPluginsPageCard = (env) => {
                const cf = env && env.configForms;
                if (!cf || typeof cf.get !== "function" || typeof cf.whileServed !== "function") return;
                ctx.effect(() => settingsStore.attach(cf.get(NS)), "dsh-codex-auth: config forms");
                ctx.effect(() => cf.whileServed([NS], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
                    name: "plugins.bundle.config",
                    key: NS,
                    locale: NS,
                    inject: () => ({ hooks: { codexAuth: settingsStore }, set: (k, v) => settingsStore.set(k, v) })
                }, () => React.createElement(StatusCard, { t: t, call: call })))), "dsh-codex-auth: plugins-page card");
            };
            if (typeof ctx.inject === "function") ctx.inject(["configForms"], registerPluginsPageCard);
            else registerPluginsPageCard(ctx);
            // ---- expired modal ----
            ctx.slots.inject("shell.overlay", () => ctx.slots.register({
                name: "shell.overlay",
                id: "codex-auth-expired-modal",
                locale: NS
            }, () => React.createElement(ExpiredModal, { t: t, call: call })));
            // Watcher: poll status; open the modal when the active session's
            // selected model routes to openai-codex and the credential is
            // expired (same modelDirectories binding as dsh-balance-panel).
            ctx.effect(function () {
                var iv = setInterval(function () {
                    var st = statusStore.value;
                    if (!st || !st.configured || !st.expired) {
                        setModal({ open: false });
                        return;
                    }
                    var provider = "";
                    try {
                        var dirs = ctx.modelDirectories;
                        var list = ctx.sessions.list() || [];
                        list.sort(function (a, b) {
                            return Number(b.updatedAt || b.touchedAt || b.seq || 0) - Number(a.updatedAt || a.touchedAt || a.seq || 0);
                        });
                        for (var i = 0; i < list.length; i++) {
                            var dir = dirs.directoryFor(list[i].id);
                            var cur = dir && dir.store && dir.store.getSnapshot && dir.store.getSnapshot();
                            cur = cur && (cur.current || cur.next || cur.lastUsed);
                            if (cur && cur.provider) {
                                provider = String(cur.provider);
                                break;
                            }
                        }
                    }
                    catch (_) { /* service unavailable */ }
                    if (provider.indexOf(PROVIDER) > -1 && Date.now() > snoozedUntil)
                        setModal({ open: true });
                }, 5000);
                return function () { clearInterval(iv); };
            }, "dsh-codex-auth: expiry watcher");
        }
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
    }
});
