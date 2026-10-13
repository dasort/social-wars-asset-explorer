'use strict';
// SWP1 reader adapted from the remotely validated v1.1 batch. No tokens in the site.
window.SWMedia=(()=>{
 const packed=new Map(),images=new Map(),definitions=new Map(),bundles=new Map(),completed=new Map(),decoded=new Map();
 const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
 let base='';
 function register(detail){
  const m=detail.media;if(!m)return;
  const u=new URL(m.base);if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.username||u.password||u.search||u.hash)throw Error('Origen externo inválido');
  if(base&&base!==u.href)throw Error('Orígenes incompatibles');base=u.href;
  for(const [id,d] of Object.entries(m.assets)){if(!/^[0-9a-f]{64}$/.test(id))throw Error('Asset inválido');definitions.set(id,d);}
  for(const [name,d] of Object.entries(m.bundles)){
   if(!/^packs\/[0-9a-f]{2}\/[0-9a-f]{64}\.swp$/.test(name))throw Error('Ruta de paquete inválida');bundles.set(name,d);
  }
 }
 async function request(url){
  for(let attempt=0;attempt<3;attempt++){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
   try{const r=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
    if(!r.ok)throw Error('HTTP '+r.status);return await r.arrayBuffer();
   }catch(e){if(attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}finally{clearTimeout(timer);}
  }
 }
 function pack(name){
  if(packed.has(name)){if(completed.has(name)){const size=completed.get(name);completed.delete(name);completed.set(name,size);}return packed.get(name);}
  const promise=(async()=>{
   const meta=bundles.get(name);if(!meta)throw Error('Falta el índice del paquete');
   const body=await request(new URL(name,base).href);
   if(body.byteLength!==meta.bytes||await digest(body)!==meta.sha256)throw Error('Paquete incompleto o alterado');
   if(body.byteLength<8||String.fromCharCode(...new Uint8Array(body,0,4))!=='SWP1')throw Error('Formato de paquete inválido');
   const n=new DataView(body).getUint32(4,true);if(n>body.byteLength-8)throw Error('Cabecera inválida');
   const header=JSON.parse(new TextDecoder().decode(new Uint8Array(body,8,n)));let offset=0;
   if(header.schema!==1)throw Error('Versión de paquete inválida');
   for(const [id,e] of Object.entries(header.assets)){
    if(!/^[0-9a-f]{64}$/.test(id)||e.offset!==offset||!Number.isSafeInteger(e.length)||e.length<1)throw Error('Índice de paquete inválido');offset+=e.length;
   }
   if(offset!==body.byteLength-8-n)throw Error('Longitud de paquete incompatible');
   completed.set(name,body.byteLength);
   while([...completed.values()].reduce((a,b)=>a+b,0)>32_000_000&&completed.size>1){const key=completed.keys().next().value;completed.delete(key);packed.delete(key);}
   return {body,start:8+n,assets:header.assets};
  })();packed.set(name,promise);promise.catch(()=>{if(packed.get(name)===promise)packed.delete(name)});return promise;
 }
 function image(f){
  const key=f.asset||f.url;
  if(images.has(key)){if(decoded.has(key)){const im=decoded.get(key);decoded.delete(key);decoded.set(key,im);}return images.get(key);}
  const promise=(async()=>{
   let raw;
   if(f.url)raw=await request(f.url);
   else{const m=definitions.get(f.asset);if(!m)throw Error('Frame fuera del inventario');const p=await pack(m.bundle),e=p.assets[f.asset];
    if(!e||e.offset!==m.offset||e.length!==m.length)throw Error('Frame incompatible');raw=p.body.slice(p.start+e.offset,p.start+e.offset+e.length);}
   if(f.asset&&await digest(raw)!==f.asset)throw Error('Imagen alterada');
   const url=URL.createObjectURL(new Blob([raw],{type:'image/webp'})),im=new Image();im.src=url;
   try{await im.decode();if(f.size&&(im.naturalWidth!==f.size[0]||im.naturalHeight!==f.size[1]))throw Error('Dimensiones incompatibles');}
   catch(e){URL.revokeObjectURL(url);throw e;}
   im.objectURL=url;decoded.set(key,im);
   while(decoded.size>256){const old=decoded.keys().next().value;URL.revokeObjectURL(decoded.get(old).objectURL);decoded.delete(old);images.delete(old);}
   return im;
  })();images.set(key,promise);promise.catch(()=>{if(images.get(key)===promise)images.delete(key)});return promise;
 }
 function draw(ctx,im,f,x,y,w,h){ctx.save();if(f.restore_mirror){ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(im,0,0,w,h);}else ctx.drawImage(im,x,y,w,h);ctx.restore();}
 async function show(canvas,f,group){
  const im=await image(f),frames=group?.fotogramas||[f];
  const crops=frames.map(e=>e.crop).filter(Boolean);const v=crops.length?[Math.min(...crops.map(c=>c[0])),Math.min(...crops.map(c=>c[1])),Math.max(...crops.map(c=>c[2])),Math.max(...crops.map(c=>c[3]))]:[0,0,im.naturalWidth,im.naturalHeight];
  const crop=f.crop||v,scale=Math.min(canvas.width/(v[2]-v[0]),canvas.height/(v[3]-v[1]));
  const left=(canvas.width-(v[2]-v[0])*scale)/2,top=(canvas.height-(v[3]-v[1])*scale)/2;
  const scratch=document.createElement('canvas');scratch.width=canvas.width;scratch.height=canvas.height;
  draw(scratch.getContext('2d'),im,f,left+(crop[0]-v[0])*scale,top+(crop[1]-v[1])*scale,(crop[2]-crop[0])*scale,(crop[3]-crop[1])*scale);
  return scratch;
 }
 async function png(f){const im=await image(f),c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;draw(c.getContext('2d'),im,f,0,0,c.width,c.height);return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('PNG vacío')),'image/png'));}
 return {register,image,show,png};
})();
