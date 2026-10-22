import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import vm from 'node:vm';

const hostSource = (await readFile(new URL('../lib/index.js', import.meta.url), 'utf8'))
 .replace("import z from './vendor/schemastery.mjs';", 'const z = {object: () => ({i18n: () => ({})})};')
 + '\nexport { registerCodexAuthRpc, callbackPage, ensureCodexModels };';
const host = await import(`data:text/javascript;base64,${Buffer.from(hostSource).toString('base64')}`);
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

function setup() {
 let route, registered, card, broken = false;
 const phase = {phase:'waiting'};
 let record;
 host.registerCodexAuthRpc({connection:{}, effect(fn){fn();}, webServer:{register(value){route=value;}}}, {
  readRecord:async()=>record,
  deleteRecord:async()=>{record=undefined;}
 }, phase);
 const react = {
  createElement:(type,props,...children)=>({type,props:props||{},children}),
  useReducer:()=>[0,()=>{}], useEffect:()=>{}, useState:initial=>[initial,()=>{}], useCallback:fn=>fn
 };
 const timers = new Map(); let timerId=0;
 const sandbox = {window:{__ModuleLoader__:{load:mod=>{registered=mod.factory(()=>react);}}},
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms}); return timerId;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(clientSource,sandbox);
 const wire = async (_channel,method,payload) => {
  if (broken === 'hang') return new Promise(()=>{});
  if (broken) return {ok:true}; // Old host response loses non-schema fields in the transport.
  const req=Readable.from([JSON.stringify({type:'client-request',rpcId:'test-id',method,payload})]);
  req.method='POST'; req.url=`/dsh-codex-auth/${method}`;
  let body;
  await route.handler(req,{writeHead(){return this;},end(text){body=JSON.parse(text);}});
  assert.equal(body.type,'server-response');
  assert.equal(body.result.ok,true);
  assert.ok(Object.hasOwn(body.result,'value'),'success envelope must contain value');
  // Connection RPC preserves only ok/value (or ok/error), not sibling business fields.
  return {ok:body.result.ok,value:body.result.value};
 };
 registered.apply({connection:{rpc:{call:wire}},effect:()=>{},
  locale:{bind:()=>key=>key === "loginFailed" ? "loginFailed: {error}" : key}, slots:{inject:(_name,fn)=>fn(),register:(spec,render)=>{if(spec.id==='codex-subscription')card=render();}}});
 return {phase,timers,setRecord:value=>{record=value;},setBroken:value=>{broken=value;},
  call:(...args)=>card.props.call(...args),render:()=>card.type(card.props)};
}
const flatten = tree => [tree,...(tree?.children||[]).flatMap(x=>x&&typeof x==='object'?flatten(x):[])];
const text = tree => JSON.stringify(tree);

test('host RPC → transport envelope → subscription panel updates success and logout',async()=>{
 const app=setup();
 await app.call('status',null);
 assert.match(text(app.render()),/waitingBrowser/);
 app.setRecord({kind:'grant',payload:{type:'oauth',access:'test',expires:Date.now()+3600000}});
 app.phase.phase='done';
 await app.call('status',null);
 const card=app.render();
 assert.match(text(card),/loginDone/); assert.match(text(card),/active/);
 const button=flatten(card).find(x=>x.type==='button'&&x.props.className.includes('primary'));
 assert.equal(button.props.disabled,false);
 assert.doesNotMatch(text(card),/waitingBrowser/);
 await app.call('logout',null);
 assert.match(text(app.render()),/missing/); assert.doesNotMatch(text(app.render()),/loginDone/);
});

test('terminal authorization errors are visible and enable retry',async()=>{
 const app=setup();app.phase.phase='error';app.phase.error='token exchange failed';
 await app.call('status',null);
 const card=app.render();assert.match(text(card),/token exchange failed/);
 assert.equal(flatten(card).find(x=>x.type==='button').props.disabled,false);
});

test('malformed legacy response fails explicitly instead of hanging',async()=>{
 const app=setup();app.setBroken(true);
 await assert.rejects(app.call('status',null),/响应格式不匹配/);
 assert.equal(app.timers.size,0);
});

test('unresponsive RPC is bounded and clears timer',async()=>{
 const app=setup();app.setBroken('hang');
 const pending=app.call('status',null);
 const timeout=[...app.timers.values()].find(t=>t.ms===12000);timeout.fn();
 await assert.rejects(pending,/超时/);assert.equal(app.timers.size,0);
});

test('callback page has safe failure text, responsive themes and app return link',()=>{
 const success=host.callbackPage();assert.match(success,/prefers-color-scheme:dark/);assert.match(success,/dsh:\/\/open/);
 const failure=host.callbackPage('<script>alert(1)</script>');
 assert.match(failure,/&lt;script&gt;/);assert.doesNotMatch(failure,/location.href=/);
});


test('authorized provider is submitted once at its settings path; existing options are preserved', async () => {
 const value = {providers:{'zai-coding-cn':{apiKeyEnv:'EXISTING_KEY'}}};
 let writes=0;
 const ctx = {
  llm: {listConfigurableProviders:()=>[{provider:'openai-codex',settingsNs:'custom-pi',settingsPath:['providers','openai-codex']}],listModels:async()=>[{id:'catalog-model'}]},
  settings: {describe:()=>[{ns:'custom-pi',revision:7,value}],mutate:async(ns,ops,revision)=>{
   assert.equal(ns,'custom-pi');assert.equal(revision,7);assert.deepEqual(ops[0].path,['providers','openai-codex']);
   value.providers['openai-codex']=ops[0].value;writes++;
  }}
 };
 assert.deepEqual(await host.ensureCodexModels(ctx),{ready:true,count:1});
 assert.equal(writes,1);assert.equal(value.providers['zai-coding-cn'].apiKeyEnv,'EXISTING_KEY');
 value.providers['openai-codex'].models=[{id:'custom-selection'}];
 await host.ensureCodexModels(ctx);
 assert.equal(writes,1);assert.equal(value.providers['openai-codex'].models[0].id,'custom-selection');
 ctx.llm.listModels=async()=>[];
 assert.match((await host.ensureCodexModels(ctx)).error,/目录为空/);
 delete value.providers['openai-codex'];
 ctx.settings.mutate=async()=>{throw new Error('configuration write failed');};
 assert.match((await host.ensureCodexModels(ctx)).error,/configuration write failed/);
});
