import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');

test('source preserves runtime proxy transport, startup refresh, scoped loader and both UI entrances',()=>{
 const host=read('src/index.ts'),client=read('src/client.ts');
 assert.match(host,/import \{ proxyFetch \} from '\.\/proxy-fetch\.mjs'/);
 assert.equal((host.match(/(?:return|await) proxyFetch\(TOKEN_URL/g)||[]).length,2);
 assert.match(host,/void silentRefresh\(credentials\)/);
 assert.equal(read('src/proxy-fetch.mjs'),read('lib/proxy-fetch.mjs'));
 assert.match(client,/id: "@sunshaobei\/dsh-codex-auth"/);
 for(const marker of ['settings.section','plugins.bundle.config','ChatGPT navigation icon'])assert.ok(client.includes(marker));
});

test('build can use an explicitly selected existing TypeScript compiler without installation',()=>{
 const build=read('scripts/build.mjs').replace(/^import .*;$/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../scripts/build.mjs',import.meta.url).href));
 const ts={ScriptTarget:{ES2020:0},ModuleKind:{ES2020:0,None:1},NewLineKind:{LineFeed:0},transpileModule:(_source,options)=>({diagnostics:[],outputText:options.fileName==='src/client.ts'?'window.__ModuleLoader__.load({id:"@sunshaobei/dsh-codex-auth",factory(){}});':'export const stub=true;'})};
 assert.doesNotThrow(()=>vm.runInNewContext(build,{readFileSync:path=>readFileSync(path,'utf8'),writeFileSync:()=>{},mkdirSync:()=>{},createRequire:()=>id=>{if(id==='/fake/compiler')return ts;throw new Error('not installed');},dirname,resolve,fileURLToPath,process:{env:{HOME:'/fake',DSH_TYPESCRIPT_PATH:'/fake/compiler'},exit(){throw new Error('unexpected exit');}},console:{log(){},error(){}}}));
});

test('build rejects wrong ModuleLoader identity even when wrapper exists',()=>{
 const build=read('scripts/build.mjs').replace(/^import .*;$/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../scripts/build.mjs',import.meta.url).href));
 const writes=[];
 const ts={ScriptTarget:{ES2020:0},ModuleKind:{ES2020:0,None:1},NewLineKind:{LineFeed:0},transpileModule:(_source,options)=>({diagnostics:[],outputText:options.fileName==='src/client.ts'?'window.__ModuleLoader__.load({id:"wrong-plugin",factory(){}});':'export const stub=true;'})};
 assert.throws(()=>vm.runInNewContext(build,{readFileSync:path=>readFileSync(path,'utf8'),writeFileSync:(path)=>writes.push(path),mkdirSync:()=>{},createRequire:()=>()=>ts,dirname,resolve,fileURLToPath,process:{env:{HOME:'/fake'},exit(){throw new Error('unexpected exit');}},console:{log(){},error(){}}}),/ModuleLoader.*identity|identity.*ModuleLoader/i);
 assert.equal(writes.some(path=>path.endsWith('/lib/client.js')),false);
});
