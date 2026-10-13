const $=id=>document.getElementById(id);
let data,resource=0,clip=null,index=0,playing=false,last=0,epoch=0,testing=false,currentName='',report=null,selection=0;
let packed=new Map(),images=new Map(),urls=new Set(),decoded=new Map(),completed=new Map(),loads=[];
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
function log(s){$('log').textContent+=s+'\n';$('log').scrollTop=$('log').scrollHeight;}
function sourceBase(){
  if($('origin').value==='local')return new URL('../assets/',location.href).href;
  const u=new URL($('base').value.trim());
  if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.username||u.password||u.search||u.hash)throw new Error('Usá una carpeta HTTPS de raw.githubusercontent.com, sin claves ni parámetros');
  if(!u.pathname.endsWith('/'))u.pathname+='/';return u.href;
}
function reset(){epoch++;playing=false;packed=new Map();images=new Map();decoded=new Map();completed=new Map();urls.forEach(URL.revokeObjectURL);urls=new Set();loads=[];}
function bundle(name){
  if(packed.has(name)){if(completed.has(name)){const bytes=completed.get(name);completed.delete(name);completed.set(name,bytes);}return packed.get(name);} const generation=epoch;
  const pending=(async()=>{
    const url=new URL(name,sourceBase()).href,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),start=performance.now();
    try{
      const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status+' en '+name);
      const body=await response.arrayBuffer(),meta=data.bundles[name];
      if(!meta||body.byteLength!==meta.bytes||await digest(body)!==meta.sha256)throw new Error('Paquete incompleto o alterado');
      const view=new DataView(body);
      if(body.byteLength<8||String.fromCharCode(...new Uint8Array(body,0,4))!=='SWP1')throw new Error('Formato de paquete inválido');
      const n=view.getUint32(4,true);if(n>body.byteLength-8)throw new Error('Cabecera inválida');
      const header=JSON.parse(new TextDecoder().decode(new Uint8Array(body,8,n)));let offset=0;
      if(header.schema!==1)throw new Error('Versión de paquete desconocida');
      for(const [id,entry] of Object.entries(header.assets)){
        if(!/^[0-9a-f]{64}$/.test(id)||!Number.isSafeInteger(entry.length)||entry.length<1||entry.offset!==offset)throw new Error('Índice de paquete inválido');
        offset+=entry.length;
      }
      if(offset!==body.byteLength-8-n)throw new Error('Longitud de imágenes incompatible');
      if(generation!==epoch)throw new Error('Carga reemplazada');
      loads.push({name,url,bytes:body.byteLength,milliseconds:Math.round(performance.now()-start)});
      completed.set(name,body.byteLength);
      while([...completed.values()].reduce((n,b)=>n+b,0)>32_000_000&&completed.size>1){const oldest=completed.keys().next().value;completed.delete(oldest);packed.delete(oldest);}
      return {body,start:8+n,assets:header.assets};
    }finally{clearTimeout(timer);}
  })();packed.set(name,pending);pending.catch(()=>{if(packed.get(name)===pending)packed.delete(name);});return pending;
}
function picture(id){
  if(images.has(id)){if(decoded.has(id)){const im=decoded.get(id);decoded.delete(id);decoded.set(id,im);}return images.get(id);}
  const generation=epoch;
  const pending=(async()=>{
    const meta=data.assets[id];if(!meta)throw new Error('Frame fuera del inventario');
    const pack=await bundle(meta.bundle),entry=pack.assets[id];
    if(!entry||entry.offset!==meta.offset||entry.length!==meta.length)throw new Error('Ubicación de imagen incompatible');
    const bytes=pack.body.slice(pack.start+entry.offset,pack.start+entry.offset+entry.length);
    if(await digest(bytes)!==id)throw new Error('Imagen alterada');
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));
    const im=new Image();im.src=url;
    try{await im.decode();if(generation!==epoch)throw new Error('Carga reemplazada');urls.add(url);im.objectURL=url;decoded.set(id,im);
      while(decoded.size>256){const oldest=decoded.keys().next().value,old=decoded.get(oldest);decoded.delete(oldest);images.delete(oldest);URL.revokeObjectURL(old.objectURL);urls.delete(old.objectURL);}
      return im;}catch(e){URL.revokeObjectURL(url);throw e;}
  })();images.set(id,pending);pending.catch(()=>{if(images.get(id)===pending)images.delete(id);});return pending;
}
function checkFrame(frame,im){
  if(im.naturalWidth!==frame.size[0]||im.naturalHeight!==frame.size[1])throw new Error('Dimensiones de frame incorrectas');
  const [x,y,r,b]=frame.crop,[w,h]=frame.canvas;
  if(!(0<=x&&x<r&&r<=w&&0<=y&&y<b&&b<=h))throw new Error('Posición de frame inválida');
}
function viewport(c){
  if(c.preview){const f=c.frames[0];return f.crop;}
  return [0,0,Math.max(...c.frames.map(f=>f.canvas[0])),Math.max(...c.frames.map(f=>f.canvas[1]))];
}
async function show(){
  if(!clip)return;
  const generation=epoch,chosen=clip,number=index,frame=chosen.frames[number];
  const im=await picture(frame.asset);if(generation!==epoch||chosen!==clip||number!==index)return;
  checkFrame(frame,im);const canvas=$('stage'),ctx=canvas.getContext('2d'),v=viewport(chosen),[x,y,r,b]=frame.crop;
  const scale=Math.min(canvas.width/(v[2]-v[0]),canvas.height/(v[3]-v[1]),1);
  const left=(canvas.width-(v[2]-v[0])*scale)/2,top=(canvas.height-(v[3]-v[1])*scale)/2;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();
  const dx=left+(x-v[0])*scale,dy=top+(y-v[1])*scale,dw=(r-x)*scale,dh=(b-y)*scale;
  if(frame.restore_mirror){ctx.translate(dx+dw,dy);ctx.scale(-1,1);ctx.drawImage(im,0,0,dw,dh);}else ctx.drawImage(im,dx,dy,dw,dh);
  ctx.restore();$('counter').textContent=(number+1)+' / '+chosen.frames.length;$('seek').value=number;
  $('details').textContent=currentName+' · '+im.naturalWidth+' × '+im.naturalHeight+' px · '+chosen.frames.length+' frames'+(chosen.fallback?' · '+chosen.status+': usa '+chosen.fallback:'');
  $('playpath').setAttribute('d',playing?'M6 4H10V20H6Z M14 4H18V20H14Z':'M7 4 20 12 7 20Z');
}
function fail(e){playing=false;$('status').textContent='Error: '+e;log(String(e));}
async function select(c,name,frameIndex=0,resume=true){
  if(testing)return;const generation=epoch,request=++selection;playing=false;clip=c;currentName=name;index=Math.min(frameIndex,c.frames.length-1);
  $('seek').max=c.frames.length-1;$('play').disabled=c.frames.length<2;$('status').textContent='Cargando '+name+'…';
  try{
    await show();
    if(request!==selection||generation!==epoch)return;
    const chosen=c,ids=[...new Set(c.frames.map(f=>f.asset))];
    for(let i=0;i<ids.length;i+=16){if(request!==selection||clip!==chosen||generation!==epoch)return;await Promise.all(ids.slice(i,i+16).map(picture));}
    if(request!==selection||clip!==chosen||generation!==epoch)return;playing=resume&&c.frames.length>1;last=performance.now();$('status').textContent='Listo. '+loads.length+' paquetes leídos; '+(loads.reduce((n,r)=>n+r.bytes,0)/1e6).toFixed(2)+' MB de contenido recibido.';await show();
  }catch(e){if(request===selection&&generation===epoch&&clip===c)fail(e);}
}
function chooseResource(preserve=false){
  const prior=preserve&&clip?{name:currentName,index,preview:!!clip.preview,playing}:null;
  if(testing)return;resource=Number($('resource').value);const r=data.resources[resource];
  $('states').replaceChildren(...Object.entries(r.states).map(([name,s])=>{const b=document.createElement('button');b.textContent=name+(s.fallback?' · '+s.status:'');b.onclick=()=>select({...s,preview:true},name);return b;}));
  const groups=r.profiles[$('profile').value];
  $('groups').replaceChildren(...groups.map(g=>{const b=document.createElement('button'),label=document.createElement('span'),count=document.createElement('small');label.textContent=g.name;count.textContent=g.frames.length+' frames';b.title=g.name;b.append(label,count);b.onclick=()=>select(g,g.name);return b;}));
  if(prior){
    const chosen=prior.preview?{...r.states[prior.name],preview:true}:groups.find(g=>g.name===prior.name);
    if(chosen){select(chosen,prior.name,prior.index,prior.playing);return;}
  }
  select({...r.states.quieto,preview:true},'quieto');
}
function toggle(){if(!clip||clip.frames.length<2||testing)return;playing=!playing;last=performance.now();show().catch(fail);}
function tick(now){if(playing&&clip){const steps=Math.floor((now-last)*(clip.fps||30)/1000);if(steps){index=(index+steps)%clip.frames.length;last+=steps*1000/(clip.fps||30);show().catch(fail);}}requestAnimationFrame(tick);}requestAnimationFrame(tick);
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportPNG(frame){const im=await picture(frame.asset),c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');if(frame.restore_mirror){ctx.translate(c.width,0);ctx.scale(-1,1);}ctx.drawImage(im,0,0);return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNG vacío')),'image/png'));}
function setControls(disabled){for(const id of ['origin','base','apply','resource','profile','test','states','groups','prev','next','play','seek','png']){const e=$(id);e.disabled=disabled;if(e.querySelectorAll)for(const b of e.querySelectorAll('button'))b.disabled=disabled;}}
async function testAll(){
  if(testing)return;testing=true;reset();setControls(true);$('save').disabled=true;$('log').textContent='';const start=performance.now();
  const origin=$('origin').value;
  report={version:'1.1',date:new Date().toISOString(),page:location.href,user_agent:navigator.userAgent,origin,external_base:origin==='remote'?$('base').value:null,
          on_github_pages:location.protocol==='https:'&&location.hostname.endsWith('.github.io'),automatic_success:false,checks:{unique_images:0,gallery_logical_frames:0,preview_logical_frames:0,png_exports:0},errors:[],loads:[],timing_note:'Se vacía la caché de la app. La caché HTTP del navegador puede seguir activa; bytes mide cuerpos recibidos, no facturación ni tráfico de red garantizado.'};
  try{
    const ids=Object.keys(data.assets);
    for(let i=0;i<ids.length;i++){
      await picture(ids[i]);report.checks.unique_images++;
      if(i%50===0){$('status').textContent='Verificando imágenes '+(i+1)+' / '+ids.length;await new Promise(resolve=>setTimeout(resolve,0));}
    }
    for(const r of data.resources){
      for(const groups of Object.values(r.profiles))for(const g of groups){
        if(g.frames.length!==g.numbers.length)throw new Error('Numeración de grupo incompatible');
        for(const f of g.frames){checkFrame(f,await picture(f.asset));report.checks.gallery_logical_frames++;}
      }
      for(const s of Object.values(r.states))for(const f of s.frames){checkFrame(f,await picture(f.asset));report.checks.preview_logical_frames++;}
      for(const s of Object.values(r.states)){await exportPNG(s.frames[0]);report.checks.png_exports++;}
      log('Correcto: '+r.key+' · '+r.pngs+' PNG originales disponibles en cada perfil.');
    }
    report.automatic_success=true;report.qualification=origin==='remote'&&report.on_github_pages?'remote_pages_pass':origin==='remote'?'remote_other_origin_pass':'local_only_pass';
    $('status').textContent='Todos los frames pasaron. '+(origin==='local'?'Falta repetir desde Pages con los paquetes externos.':'Guardá los resultados y evaluá la calidad.');
  }catch(e){report.errors.push(String(e));report.qualification='failed';fail(e);}
  finally{report.seconds=+( (performance.now()-start)/1000).toFixed(2);report.loads=[...loads];report.response_body_bytes=loads.reduce((n,r)=>n+r.bytes,0);testing=false;setControls(false);$('save').disabled=false;}
}
$('test').onclick=testAll;
$('apply').onclick=()=>{reset();chooseResource();};$('resource').onchange=()=>chooseResource();$('profile').onchange=()=>chooseResource(true);
$('save').onclick=()=>{report.quality_choice=$('quality').value;report.notes=$('notes').value;download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'resultados_lote.json');};
$('play').onclick=toggle;
for(const [id,delta] of [['prev',-1],['next',1]])$(id).onclick=()=>{if(!clip||testing)return;playing=false;index=(index+delta+clip.frames.length)%clip.frames.length;show().catch(fail);};
$('seek').oninput=()=>{playing=false;index=Number($('seek').value);show().catch(fail);};
$('png').onclick=async()=>{try{if(clip)download(await exportPNG(clip.frames[index]),'frame-'+(index+1)+'.png');}catch(e){fail(e);}};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)){e.preventDefault();toggle();}});
setControls(true);
try{
  const response=await fetch('lote.json');if(!response.ok)throw new Error('Falta lote.json');data=await response.json();if(data.schema!==1||!data.resources.length)throw new Error('Lote inválido');
  $('resource').replaceChildren(...data.resources.map((r,i)=>{const o=document.createElement('option');o.value=i;o.textContent=r.name+' · '+r.pngs+' PNG';return o;}));$('resource').value='0';
  if(location.hostname.endsWith('.github.io'))$('origin').value='remote';setControls(false);chooseResource();
}catch(e){fail(e);}
