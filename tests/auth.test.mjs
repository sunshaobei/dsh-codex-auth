import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

const source = (await readFile(new URL('../lib/index.js', import.meta.url), 'utf8'))
 .replace("import http from 'node:http';", 'const http = globalThis.__authTest.http;')
 .replace("import { execFile } from 'node:child_process';", 'const execFile = globalThis.__authTest.execFile;')
 .replace("import { proxyFetch } from './proxy-fetch.mjs';", 'const proxyFetch = (...args) => globalThis.fetch(...args);')
 .replace("import z from './vendor/schemastery.mjs';", 'const z = {object: () => ({i18n: () => ({})})};')
 + '\nexport { runBrowserLogin, readStatus, silentRefresh };';

test('OAuth callback only reports success after persistence, exposes failures, permits retry', async () => {
 let callback, server, url, record, failWrite = false, tokenFail = false;
 globalThis.__authTest = {
  http: { createServer(handler) { callback = handler; server = new EventEmitter(); server.close = () => {}; server.listen = (_p, _h, ready) => ready(); return server; } },
  execFile(_cmd, args, done) { url = new URL(args.at(-1)); done(); }
 };
 const originalFetch = globalThis.fetch;
 const claims = Buffer.from(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id:'test-account'}})).toString('base64url');
 globalThis.fetch = async () => ({ok: !tokenFail, status: tokenFail ? 401 : 200, json: async () => tokenFail ? {error:'invalid_grant'} : {access_token:`a.${claims}.b`, refresh_token:'test-refresh', expires_in:3600}});
 try {
 const {runBrowserLogin, readStatus, silentRefresh, apply} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const credentials = { readRecord: async () => record, modifyRecord: async (_key, mutate) => { if (failWrite) throw new Error('disk write failed'); record = await mutate(); } };
 const phase = {phase:'idle'};
 function respond(query) {
  const res = {code:0, body:'', writeHead(code) {this.code=code; return this;}, end(body) {this.body=body; return this;}};
  callback({url:`/auth/callback?${query}`}, res); return res;
 }
 let login = runBrowserLogin(credentials, phase);
 const invalid = respond('code=test&state=wrong');
 assert.equal(invalid.code,400); assert.equal(phase.phase,'waiting');
 const res = respond(`code=test&state=${url.searchParams.get('state')}`);
 assert.equal(res.body,'');
 assert.equal((await login).phase,'done');
 assert.equal((await readStatus(credentials)).configured,true);
 assert.match(res.body,/dsh:\/\/open/); assert.match(res.body,/凭证已保存/);
 failWrite=true;
 login=runBrowserLogin(credentials,phase);
 const failed=respond(`code=test&state=${url.searchParams.get('state')}`);
 assert.equal((await login).phase,'error'); assert.match(failed.body,/disk write failed/); assert.doesNotMatch(failed.body,/<h2>授权成功/);
 failWrite=false; tokenFail=true;
 login=runBrowserLogin(credentials,phase);
 const denied=respond(`code=test&state=${url.searchParams.get('state')}`);
 assert.equal((await login).phase,'error'); assert.match(denied.body,/invalid_grant/);
 tokenFail=false;
 login=runBrowserLogin(credentials,phase);
 assert.equal((await runBrowserLogin(credentials,phase)).phase,'waiting');
 respond(`error=access_denied&state=${url.searchParams.get('state')}`);
 assert.equal((await login).phase,'error');
 const savedRecord=record;
 login=runBrowserLogin(credentials,phase);
 const previousState=url.searchParams.get('state');
 await phase.cancel();
 assert.equal((await login).phase,'idle');
 assert.equal(record,savedRecord,'cancel must preserve existing credential');
 assert.equal(phase.cancel,undefined);
 login=runBrowserLogin(credentials,phase);
 assert.notEqual(url.searchParams.get('state'),previousState);
 respond(`code=test&state=${previousState}`);
 assert.equal(phase.phase,'waiting','old callback must not complete new login');
 await phase.cancel();
 await login;
 login=runBrowserLogin(credentials,phase);
 server.emit('error',Object.assign(new Error('in use'),{code:'EADDRINUSE'}));
 assert.match((await login).error,/1455/);
 // Reconciled runtime must keep proxy-backed silent refresh and startup use.
 let refreshCalls=0;
 globalThis.fetch=async(endpoint,options)=>{
  assert.equal(endpoint,'https://auth.openai.com/oauth/token');
  assert.equal(options.body.get('grant_type'),'refresh_token');
  assert.equal(options.body.get('refresh_token'),'test-refresh');refreshCalls++;
  return {ok:true,json:async()=>({access_token:'fake-refreshed',expires_in:3600})};
 };
 const before=record;
 await silentRefresh(credentials);
 assert.equal(record.payload.access,'fake-refreshed');
 assert.equal(record.payload.refresh,before.payload.refresh);
 assert.equal(record.payload.accountId,before.payload.accountId);
 const refreshed=record;
 globalThis.fetch=async()=>({ok:false});
 await silentRefresh(credentials);assert.equal(record,refreshed,'failed refresh preserves old grant');
 let startupRead;
 const readOnStartup=new Promise(resolve=>{startupRead=resolve;});
 apply({credentials:{readRecord:async()=>{startupRead();return undefined;}},effect:fn=>fn(),webServer:{register(){}}});
 await readOnStartup;assert.equal(refreshCalls,1);
 } finally {globalThis.fetch=originalFetch; delete globalThis.__authTest;}
});
