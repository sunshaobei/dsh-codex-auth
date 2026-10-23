import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../lib/index.js', import.meta.url), 'utf8'))
 .replace("import { proxyFetch } from './proxy-fetch.mjs';", 'const proxyFetch = () => { throw new Error("network forbidden in model tests"); };')
 .replace("import z from './vendor/schemastery.mjs';", 'const z = {object: () => ({i18n: () => ({})})};')
 + '\nexport { ensureCodexModels };';
const {ensureCodexModels} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const verified = ['gpt-5.5','gpt-5.6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-6-astra','gpt-6-luna','gpt-6-sol','gpt-6.1-sol'];
const installed = [{id:'gpt-5.3-codex-spark',contextWindow:128000,maxTokens:128000}, ...verified.map(id=>({id,contextWindow:1050000,maxTokens:32000}))];
function setup(provider, models = installed) {
 const path = ['nested','routes','codex'];
 const doc = {ns:'instance-specific-pi',revision:37,value:{nested:{routes:{codex:provider,other:{keep:true}}}}};
 const writes = [];
 const ctx = {
  llm: {listConfigurableProviders:async()=>[{provider:'openai-codex',settingsNs:doc.ns,settingsPath:path}],listModels:async p=>{assert.equal(p,'openai-codex');return structuredClone(models);}},
  settings: {describe:async()=>[structuredClone(doc)],mutate:async(ns,ops,revision)=>{
   assert.equal(ns,doc.ns); assert.equal(revision,doc.revision); assert.deepEqual(ops[0].path,path);
   writes.push(structuredClone(ops)); doc.value.nested.routes.codex=ops[0].value; doc.revision++;
  }}
 };
 return {ctx,doc,writes,current:()=>doc.value.nested.routes.codex};
}

test('fixed models retain IDs, order and options without adding catalog models or overrides',async()=>{
 const models=[{id:'custom-selection',maxTokens:777,options:{keep:true}}, {id:'gpt-6.1-sol',name:'Selected',contextWindow:200000,maxTokens:32000,options:{temperature:0.7}}, {id:'gpt-5.3-codex-spark',contextWindow:128000,maxTokens:128000}];
 const original={displayName:'My fixed group',baseURL:'https://example.invalid',headers:{x:'kept'},options:{keep:true},models};
 const app=setup(structuredClone(original));
 const previous=app.current();
 assert.deepEqual(await ensureCodexModels(app.ctx),{ready:true,count:9});
 assert.equal(app.writes.length,1);
 assert.deepEqual(app.current(),{...original,models:[models[0],{...models[1],contextWindow:1000000,maxTokens:128000},{...models[2],contextWindow:1000000}]});
 assert.equal(Object.hasOwn(app.current(),'modelOverrides'),false);
 assert.deepEqual(previous,original,'do not mutate the existing provider object');
 await ensureCodexModels(app.ctx); assert.equal(app.writes.length,1,'equal fixed model values do not write again');
});

test('catalog modelOverrides merge per exact installed ID while preserving provider and unrelated overrides',async()=>{
 const original={displayName:'My catalog',options:{keep:true},modelOverrides:{'gpt-6.1-sol':{name:'Personal',options:{temperature:0.4},maxTokens:30000},'not-installed':{maxTokens:123},'gpt-5.3-codex-spark':{maxTokens:64000}}};
 const app=setup(structuredClone(original));
 await ensureCodexModels(app.ctx);
 const expected={...original,modelOverrides:{...original.modelOverrides}};
 for(const id of verified)expected.modelOverrides[id]={...original.modelOverrides[id],contextWindow:1000000,maxTokens:128000};
 expected.modelOverrides['gpt-5.3-codex-spark']={maxTokens:64000,contextWindow:1000000};
 assert.deepEqual(app.current(),expected); assert.equal(app.writes.length,1);
 assert.equal(Object.hasOwn(app.current(),'models'),false);
 await ensureCodexModels(app.ctx); assert.equal(app.writes.length,1);
});

test('already equal catalog values are idempotent independent of property ordering',async()=>{
 const app=setup({modelOverrides:Object.fromEntries(installed.map(m=>[m.id,{maxTokens:128000,contextWindow:1000000}]))});
 await ensureCodexModels(app.ctx); assert.equal(app.writes.length,0);
});

test('unknown GPT aliases retain output values and non-GPT catalog entries remain untouched',async()=>{
 const app=setup({modelOverrides:{'gpt-future':{maxTokens:54321,options:{keep:true}}}},[{id:'gpt-future',maxTokens:99999},{id:'gpt-other-alias',maxTokens:1234},{id:'other-model',maxTokens:300}]);
 await ensureCodexModels(app.ctx);
 assert.deepEqual(app.current().modelOverrides,{'gpt-future':{maxTokens:54321,options:{keep:true},contextWindow:1000000},'gpt-other-alias':{contextWindow:1000000}});
});

test('missing provider activates catalog first then uses refreshed revision for model policy',async()=>{
 const app=setup(undefined);
 assert.deepEqual(await ensureCodexModels(app.ctx),{ready:true,count:9});
 assert.equal(app.writes.length,2); assert.equal(app.doc.revision,39);
 assert.equal(app.current().displayName,'Codex (ChatGPT)');
 assert.equal(app.current().modelOverrides['gpt-6.1-sol'].maxTokens,128000);
});

test('model policy never shares mutable configuration between host instances',async()=>{
 const a=setup({options:{instance:'a'}}); const b=setup({options:{instance:'b'}});
 await Promise.all([ensureCodexModels(a.ctx),ensureCodexModels(b.ctx)]);
 assert.equal(a.current().options.instance,'a'); assert.equal(b.current().options.instance,'b');
 assert.equal(a.writes.length,1);assert.equal(b.writes.length,1);
 a.current().modelOverrides['gpt-6.1-sol'].maxTokens=1;
 assert.equal(b.current().modelOverrides['gpt-6.1-sol'].maxTokens,128000);
});
