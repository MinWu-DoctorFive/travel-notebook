import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

test('offline bundle stays in the GitHub project scope and reloads cached HTML',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'travel-offline-'));
  try{
    await mkdir(join(temp,'dist/assets'),{recursive:true});
    await writeFile(join(temp,'dist/index.html'),'<html>travel notebook</html>');
    await writeFile(join(temp,'dist/assets/app.js'),'export const ready=true;');
    execFileSync(process.execPath,[resolve('scripts/build-offline.mjs')],{cwd:temp});
    const source=await readFile(join(temp,'dist/sw.js'),'utf8');
    assert(!source.includes('./.nojekyll'));
    const handlers:Record<string,Function>={},cached:Map<string,unknown>=new Map();
    const workerUrl='https://example.github.io/travel-notebook/sw.js';
    const cache={addAll:async(paths:string[])=>{for(const path of paths){assert(path.startsWith('./'));cached.set(new URL(path,workerUrl).href,{path});}},match:async(key:string|{url:string})=>cached.get(typeof key==='string'?key:key.url)};
    let claimed=false;
    runInNewContext(source,{
      URL,Promise,
      self:{location:{href:workerUrl},clients:{claim:async()=>{claimed=true}},addEventListener:(name:string,handler:Function)=>{handlers[name]=handler}},
      caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},
      fetch:async()=>{throw new Error('offline')},
    });
    let pending:Promise<unknown>|undefined;
    handlers.install({waitUntil:(p:Promise<unknown>)=>{pending=p}});await pending;
    handlers.activate({waitUntil:(p:Promise<unknown>)=>{pending=p}});await pending;assert(claimed);
    let navigation:Promise<unknown>|undefined;
    handlers.fetch({request:{method:'GET',url:'https://example.github.io/travel-notebook/',mode:'navigate'},respondWith:(p:Promise<unknown>)=>{navigation=p}});
    assert.deepEqual(await navigation,{path:'./index.html'});
    const imageRequest={method:'GET',url:'https://example.github.io/travel-notebook/icon-192.png',mode:'cors'};
    handlers.fetch({request:imageRequest,respondWith:(p:Promise<unknown>)=>{navigation=p}});assert.deepEqual(await navigation,{path:'./icon-192.png'});
    let intercepted=false;
    handlers.fetch({request:{method:'GET',url:'https://example.github.io/another-project/',mode:'navigate'},respondWith:()=>{intercepted=true}});
    assert.equal(intercepted,false);
  }finally{await rm(temp,{recursive:true,force:true})}
});
