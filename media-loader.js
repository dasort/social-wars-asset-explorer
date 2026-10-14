'use strict';
// Shared bounded network queue, immutable disk cache, decoded LRU and SWP1 reader.
window.SWMedia=(()=>{
 const MB=1024*1024,DISK=128*MB,RAM=48*MB,PIXELS=64*MB;
 const packed=new Map(),images=new Map(),definitions=new Map(),bundles=new Map();
 const pending=new Map(),queue=[],pauses=new Map();let active=0,nextStart=0,wake=null,disk=null,diskFailed=false,diskChain=Promise.resolve(),diskIndex=null;
 const stats={requests:0,cacheHits:0,bytes:0,rateLimits:0};let base='';
 const abort=()=>new DOMException('Carga cancelada','AbortError');
 const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const migrated=url=>String(url).replace(/^https:\/\/raw\.githubusercontent\.com\/dasort\/sw-prueba-releases\//,'https://raw.githubusercontent.com/dasort/social-wars-asset-explorer/');
 const absolute=url=>new URL(migrated(url),document.baseURI).href;
 function networkNotice(until){window.dispatchEvent(new CustomEvent('sw-network-wait',{detail:{until}}));}
 async function cache(){if(diskFailed)return null;try{return disk||(disk=await caches.open('sw-media-v106'));}catch{diskFailed=true;return null;}}
 async function diskRead(url){try{const c=await cache(),r=c&&await c.match(url);if(r){stats.cacheHits++;return await r.arrayBuffer();}}catch{}return null;}
 function diskWrite(url,body){
  if(body.byteLength>16*MB)return;
  diskChain=diskChain.then(async()=>{try{const c=await cache();if(!c)return;
   // Bounded FIFO in storage; runtime LRU handles the hot images separately.
   if(!diskIndex){diskIndex=new Map();for(const key of await c.keys()){const r=await c.match(key);diskIndex.set(key.url,Number(r.headers.get('Content-Length'))||0);}}
   await c.put(url,new Response(body,{headers:{'Content-Length':String(body.byteLength)}}));diskIndex.delete(url);diskIndex.set(url,body.byteLength);
   let total=[...diskIndex.values()].reduce((a,b)=>a+b,0);
   for(const [key,n] of diskIndex){if(total<=DISK)break;await c.delete(key);diskIndex.delete(key);total-=n;}
  }catch{diskFailed=true;}});
 }
 function pump(){
  clearTimeout(wake);wake=null;if(active>=3||!queue.length)return;
  queue.sort((a,b)=>Math.min(...a.clients.map(c=>c.priority))-Math.min(...b.clients.map(c=>c.priority)));
  const now=Date.now();let chosen=-1,wait=Infinity;
  for(let i=queue.length-1;i>=0;i--){const q=queue[i];q.clients=q.clients.filter(c=>{if(c.signal?.aborted){c.reject(abort());return false;}return true;});if(!q.clients.length){queue.splice(i,1);pending.delete(q.url);}}
  for(let i=0;i<queue.length;i++){const delay=Math.max(nextStart-now,(pauses.get(new URL(queue[i].url).origin)||0)-now,0);if(!delay){chosen=i;break;}wait=Math.min(wait,delay);}
  if(chosen<0){if(Number.isFinite(wait))wake=setTimeout(pump,Math.max(wait,10));return;}
  const q=queue.splice(chosen,1)[0];active++;nextStart=now+350;
  (async()=>{
   let body=q.immutable?await diskRead(q.url):null;
   if(!body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);let response;
    try{stats.requests++;response=await fetch(q.url,{signal:controller.signal,credentials:'omit',mode:'cors',cache:'default'});
     if(response.status===429||response.status===503){
      const h=response.headers.get('Retry-After');const seconds=h&&/^\d+$/.test(h)?Number(h):h?Math.max(0,(Date.parse(h)-Date.now())/1000):60;
      const until=Date.now()+Math.max(60,Number.isFinite(seconds)?seconds:60)*1000;pauses.set(new URL(q.url).origin,until);stats.rateLimits++;networkNotice(until);
      const e=Error('Servidor temporalmente limitado; la carga se reanudará después de la pausa.');e.retryAt=until;throw e;
     }
     if(!response.ok)throw Error('HTTP '+response.status);
     body=await response.arrayBuffer();stats.bytes+=body.byteLength;
    }finally{clearTimeout(timer);}
    if(q.immutable)diskWrite(q.url,body);
   }
   for(const c of q.clients)c.signal?.aborted?c.reject(abort()):c.resolve(body);
  })().catch(e=>{for(const c of q.clients)c.reject(e);}).finally(()=>{active--;pending.delete(q.url);pump();});pump();
 }
 async function request(url,options={}){
  url=absolute(url);if(options.signal?.aborted)throw abort();
  const immutable=options.immutable??/\/[0-9a-f]{64}\.(swp|webp)$/.test(new URL(url).pathname);
  if(immutable){const body=await diskRead(url);if(options.signal?.aborted)throw abort();if(body)return body;}
  return new Promise((resolve,reject)=>{const client={resolve,reject,priority:options.priority??1,signal:options.signal};let q=pending.get(url);
   if(q)q.clients.push(client);else{q={url,clients:[client],immutable};pending.set(url,q);queue.push(q);}pump();});
 }
 function touch(map,key){const v=map.get(key);if(v){map.delete(key);map.set(key,v);}return v;}
 function trim(map,max){let total=[...map.values()].reduce((s,v)=>s+(v.bytes||0),0);for(const [key,v] of map){if(total<=max)break;if(!v.ready)continue;total-=v.bytes;map.delete(key);if(v.url)URL.revokeObjectURL(v.url);}}
 function register(detail){const m=detail.media;if(!m)return;const u=new URL(migrated(m.base));
  if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.username||u.password||u.search||u.hash)throw Error('Origen externo inválido');
  if(base&&base!==u.href)throw Error('Orígenes incompatibles');base=u.href;
  for(const [id,d] of Object.entries(m.assets)){if(!/^[0-9a-f]{64}$/.test(id))throw Error('Asset inválido');definitions.set(id,d);}
  for(const [name,d] of Object.entries(m.bundles)){if(!/^packs\/[0-9a-f]{2}\/[0-9a-f]{64}\.swp$/.test(name))throw Error('Paquete inválido');bundles.set(name,d);}
 }
 function descriptor(f){if(f.pack){const d=f.pack,u=new URL(migrated(d.url),document.baseURI);const local=u.origin===new URL(document.baseURI).origin&&/^media\/optimized\/[0-9a-f]{2}\/[0-9a-f]{64}\.swp$/.test(d.url);const remote=u.protocol==='https:'&&u.hostname==='raw.githubusercontent.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[^/]+\/[^/]+\/sw-assets-[0-9a-f]+\/webmedia\/[0-9a-f]{2}\/[0-9a-f]{64}\.swp$/.test(u.pathname);if(!local&&!remote)throw Error('Paquete inválido');return {...d,url:u.href};}
  const m=definitions.get(f.asset);if(!m)throw Error('Frame fuera del inventario');const d=bundles.get(m.bundle);if(!d)throw Error('Falta paquete');return {...d,url:new URL(m.bundle,base).href};}
 async function pack(d,options){
  let entry=touch(packed,d.url);if(entry?.ready)return entry.value;
  // Request queue deduplicates bytes; verification and parsing are shared separately.
  if(entry?.promise)return entry.promise.catch(e=>{if(e.name==='AbortError'&&!options.signal?.aborted)return pack(d,options);throw e;});
  entry={ready:false,bytes:0};packed.set(d.url,entry);
  entry.promise=(async()=>{const body=await request(d.url,{...options,immutable:true});
   if(body.byteLength!==d.bytes||await digest(body)!==d.sha256){await diskChain;const c=await cache();await c?.delete(d.url);throw Error('Paquete incompleto o alterado');}
   if(body.byteLength<8||String.fromCharCode(...new Uint8Array(body,0,4))!=='SWP1')throw Error('Formato inválido');
   const n=new DataView(body).getUint32(4,true);if(n>body.byteLength-8)throw Error('Cabecera inválida');
   const header=JSON.parse(new TextDecoder().decode(new Uint8Array(body,8,n)));let offset=0;if(header.schema!==1)throw Error('Versión inválida');
   for(const [id,e] of Object.entries(header.assets)){if(!/^[0-9a-f]{64}$/.test(id)||e.offset!==offset||!Number.isSafeInteger(e.length)||e.length<1)throw Error('Índice inválido');offset+=e.length;}
   if(offset!==body.byteLength-8-n)throw Error('Longitud inválida');entry.value={body,start:8+n,assets:header.assets};entry.bytes=body.byteLength;entry.ready=true;trim(packed,RAM);return entry.value;
  })().catch(e=>{packed.delete(d.url);throw e;});return entry.promise;
 }
 function key(f){return f.asset||absolute(f.url);}
 async function image(f,options={}){
  if(options.signal?.aborted)throw abort();const id=key(f);let entry=touch(images,id);if(entry)return entry.promise.catch(e=>{if(e.name==='AbortError'&&!options.signal?.aborted)return image(f,options);throw e;});
  entry={ready:false,bytes:0};images.set(id,entry);
  entry.promise=(async()=>{let raw;
   if(f.pack||(!f.url&&f.asset)){const p=await pack(descriptor(f),options),m=f.pack?f:definitions.get(f.asset),e=p.assets[f.asset];if(!e||e.offset!==m.offset||e.length!==m.length)throw Error('Frame incompatible');raw=p.body.slice(p.start+e.offset,p.start+e.offset+e.length);}
   else raw=await request(f.url,{...options,immutable:true});
   if(options.signal?.aborted)throw abort();if(f.asset&&await digest(raw)!==f.asset)throw Error('Imagen alterada');
   const url=URL.createObjectURL(new Blob([raw],{type:'image/webp'})),im=new Image();im.src=url;
   try{await im.decode();if(f.size&&(im.naturalWidth!==f.size[0]||im.naturalHeight!==f.size[1]))throw Error('Dimensiones incompatibles');}catch(e){URL.revokeObjectURL(url);throw e;}
   im.objectURL=url;entry.url=url;entry.bytes=im.naturalWidth*im.naturalHeight*4;entry.ready=true;trim(images,PIXELS);return im;
  })().catch(e=>{images.delete(id);throw e;});return entry.promise;
 }
 function frames(preview){return (preview?.fotogramas||[]).map(f=>preview.pack?{...f,pack:preview.pack}:f);}
 // Sequential within a sequence; different visible sequences share the bounded queue.
 async function prepare(fs,onFrame,options={}){for(let i=0;i<fs.length;i++){if(options.signal?.aborted)throw abort();const im=await image(fs[i],options);if(options.signal?.aborted)throw abort();onFrame(im,i);}}
 function draw(ctx,im,f,x,y,w,h){ctx.save();if(f.restore_mirror){ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(im,0,0,w,h);}else ctx.drawImage(im,x,y,w,h);ctx.restore();}
 function paint(canvas,im,f,group){const frames=group?.fotogramas||[f],crops=frames.map(e=>e.crop).filter(Boolean);
  const v=crops.length?[Math.min(...crops.map(c=>c[0])),Math.min(...crops.map(c=>c[1])),Math.max(...crops.map(c=>c[2])),Math.max(...crops.map(c=>c[3]))]:[0,0,im.naturalWidth,im.naturalHeight];
  const crop=f.crop||v,scale=Math.min(canvas.width/(v[2]-v[0]),canvas.height/(v[3]-v[1])),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  draw(ctx,im,f,(canvas.width-(v[2]-v[0])*scale)/2+(crop[0]-v[0])*scale,(canvas.height-(v[3]-v[1])*scale)/2+(crop[1]-v[1])*scale,(crop[2]-crop[0])*scale,(crop[3]-crop[1])*scale);
 }
 async function show(canvas,f,group){const im=await image(f,{priority:0});const scratch=document.createElement('canvas');scratch.width=canvas.width;scratch.height=canvas.height;paint(scratch,im,f,group);return scratch;}
 async function png(f){const im=await image(f,{priority:0}),c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;draw(c.getContext('2d'),im,f,0,0,c.width,c.height);return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('PNG vacío')),'image/png'));}
 async function json(url){return JSON.parse(new TextDecoder().decode(await request(url,{priority:0,immutable:/[?&]v=0\.5\.4(?:&|$)/.test(url)})));}
 return {register,image,show,paint,png,frames,prepare,json,stats,request};
})();
