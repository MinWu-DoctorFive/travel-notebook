import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

// A small code-drawn compass icon; the website has no runtime image service.
function crc32(bytes) { let crc=0xffffffff; for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0; }
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function icon(size){const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++){for(let x=0;x<size;x++){let color=[40,75,60,255];const a=x/size-.5,b=y/size-.5,r=Math.hypot(a,b);if(Math.abs(r-.31)<.014)color=[247,240,223,255];if(Math.abs(a+b*.5)<.055&&Math.abs(b)<.21)color=b<0?[255,253,248,255]:[234,213,166,255];if(r<.025)color=[40,75,60,255];const p=y*(size*4+1)+1+x*4;raw.set(color,p);}}const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
for(const size of [192,512])await writeFile(`dist/icon-${size}.png`,icon(size));
await writeFile('dist/.nojekyll','');
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const path=join(dir,e.name);if(e.isDirectory())out.push(...await walk(path));else if(e.name!=='sw.js')out.push(path)}return out;}
const files=await walk('dist');
const digest=createHash('sha256');for(const file of files.sort())digest.update(await readFile(file));
const version=digest.digest('hex').slice(0,16), paths=files.map(file=>`./${relative('dist',file).split(sep).join('/')}`);
await writeFile('dist/sw.js',`const CACHE='travel-notebook-${version}';
const FILES=${JSON.stringify(paths)};
const BASE=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('travel-notebook-')&&name!==CACHE).map(name=>caches.delete(name)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match(new URL('./index.html',BASE).href))));return;
 }
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});
`);
console.log(`Offline bundle: ${files.length} files, version ${version}`);
