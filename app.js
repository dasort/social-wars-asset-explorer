const $ = id => document.getElementById(id);
let config, pack, pictures = new Map(), blobs = [], state = 0, index = 0, playing = false, last = 0, busy = false;
let report = null;
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
function log(message) { $('log').textContent += message + '\n'; }
async function request(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),20000);
  const start = performance.now();
  try {
    const response = await fetch(url,{mode:'cors',credentials:'omit',redirect:'follow',signal:controller.signal,headers:accept?{Accept:accept}:{}});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const length = Number(response.headers.get('content-length')||0);
    if(length>2000000) throw new Error('Respuesta demasiado grande para esta prueba');
    const bytes = await response.arrayBuffer();
    if(bytes.byteLength>2000000) throw new Error('Respuesta demasiado grande para esta prueba');
    return {bytes, milliseconds:Math.round(performance.now()-start), final_url:response.url, content_type:response.headers.get('content-type')};
  } finally { clearTimeout(timer); }
}
async function validate(bytes) {
  if(bytes.byteLength!==config.bytes || await sha(bytes)!==config.sha256) throw new Error('El archivo recibido no coincide con el paquete de prueba');
  const candidate = JSON.parse(new TextDecoder().decode(bytes));
  if(candidate.schema!==1 || Object.keys(candidate.assets).length!==config.assets) throw new Error('Inventario de imágenes incorrecto');
  const decoded = new Map(), urls = [];
  try {
    for(const [id,asset] of Object.entries(candidate.assets)) {
      const raw = Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));
      if(raw.length!==asset.bytes || await sha(raw)!==id) throw new Error('Imagen alterada: '+id);
      const url = URL.createObjectURL(new Blob([raw],{type:asset.mime})); urls.push(url);
      const image = new Image(); image.src=url; await image.decode();
      if(!image.naturalWidth || !image.naturalHeight) throw new Error('Imagen sin dimensiones');
      decoded.set(id,image);
    }
    let count=0;
    for(const seq of candidate.sequences) {
      if(seq.numbers.length!==seq.frames.length || !(seq.fps>0)) throw new Error('Secuencia inválida');
      for(const frame of seq.frames) {
        const im = decoded.get(frame.asset);
        if(!im || im.naturalWidth!==frame.size[0] || im.naturalHeight!==frame.size[1]) throw new Error('Frame ausente o dimensiones incorrectas');
        const canvas=document.createElement('canvas'); canvas.width=im.naturalWidth; canvas.height=im.naturalHeight;
        canvas.getContext('2d').drawImage(im,0,0);
        if(!canvas.toDataURL('image/png').startsWith('data:image/png;base64,')) throw new Error('Exportación PNG fallida');
        count++;
      }
    }
    if(count!==config.frames) throw new Error('Cantidad de frames incorrecta');
    playing=false; blobs.forEach(URL.revokeObjectURL); blobs=urls; pictures=decoded; pack=candidate;
    $('state').replaceChildren(...pack.sequences.map((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.name;return o;}));
    state=0;index=0;
    for(const id of ['state','prev','next','play','png']) $(id).disabled=false;
    show();
    return {unique_images:decoded.size, logical_frames:count, png_export:true, integrity:true};
  } catch(error) {urls.forEach(URL.revokeObjectURL);throw error;}
}
function show() {
  const seq=pack.sequences[state];
  $('image').src=pictures.get(seq.frames[index].asset).src; $('image').hidden=false;
  $('counter').textContent=(index+1)+' / '+seq.frames.length;
  $('play').disabled=seq.frames.length<2;
  $('playpath').setAttribute('d',playing?'M6 4H10V20H6Z M14 4H18V20H14Z':'M7 4 20 12 7 20Z');
}
function step(delta) {if(!pack)return;playing=false;index=(index+delta+pack.sequences[state].frames.length)%pack.sequences[state].frames.length;show();}
function toggle() {if(!pack || pack.sequences[state].frames.length<2)return;playing=!playing;last=performance.now();show();}
function tick(now) {if(playing && pack){const seq=pack.sequences[state];const steps=Math.floor((now-last)*seq.fps/1000);if(steps){index=(index+steps)%seq.frames.length;last+=steps*1000/seq.fps;show();}}requestAnimationFrame(tick);}
requestAnimationFrame(tick);
function download(blob,name) {const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function run() {
  if(busy)return;
  const repo=$('repo').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)){$('status').textContent='Ingresá propietario/repositorio, por ejemplo dasort/sw-prueba-releases.';return;}
  busy=true;playing=false;$('run').disabled=true;$('local').disabled=true;$('save').disabled=true;$('log').textContent='';
  const onPages=location.protocol==='https:'&&location.hostname.endsWith('.github.io');
  report={version:'1.0',date:new Date().toISOString(),page:location.href,user_agent:navigator.userAgent,repository:repo,on_github_pages:onPages,automatic_success:false,attempts:[],qualification:'pending',expected:config};
  $('status').textContent='Comprobando acceso desde el navegador…';
  try {
    const direct='https://github.com/'+repo+'/releases/download/'+encodeURIComponent(config.tag)+'/'+config.asset_name;
    const routes=[{name:'Enlace directo de Releases',url:direct}];
    let success=false;
    for(let routeIndex=0;routeIndex<routes.length;routeIndex++) {
      const route=routes[routeIndex];log('Probando: '+route.name);
      try {
        const fetched=await request(route.url,route.accept);
        const checks=await validate(fetched.bytes);
        report.attempts.push({route:route.name,url:route.url,ok:true,milliseconds:fetched.milliseconds,final_url:fetched.final_url,content_type:fetched.content_type,checks});
        report.automatic_success=true;success=true;log('Carga, integridad, '+checks.logical_frames+' frames y exportación PNG: correctos.');break;
      } catch(error) {report.attempts.push({route:route.name,url:route.url,ok:false,error:String(error)});log('No funcionó: '+String(error));}
      if(routeIndex===0) {
        try {
          const metadata=await request('https://api.github.com/repos/'+repo+'/releases/tags/'+encodeURIComponent(config.tag));
          const release=JSON.parse(new TextDecoder().decode(metadata.bytes));
          const asset=release.assets?.find(a=>a.name===config.asset_name);
          if(!asset || !Number.isSafeInteger(asset.id)) throw new Error('No se encontró sw-prueba.json en la release prueba-v1');
          report.metadata={ok:true,asset_id:asset.id,size:asset.size};
          routes.push({name:'API pública de Releases',url:'https://api.github.com/repos/'+repo+'/releases/assets/'+asset.id,accept:'application/octet-stream'});
        } catch(error){report.metadata={ok:false,error:String(error)};log('Consulta de release: '+String(error));}
      }
    }
    report.qualification=success?(onPages?'automatic_pages_pass':'automatic_other_origin_pass'):'automatic_failed';
    $('status').textContent=success?(onPages?'La carga automática desde Pages funcionó en esta muestra. Probá también los controles y descargá los resultados.':'La carga automática funcionó en este origen. Falta repetir desde GitHub Pages.'):'La carga automática no funcionó. Descargar el archivo manualmente no valida esta arquitectura. Guardá los resultados.';
    if(!success) log('Un error de fetch puede corresponder a CORS, conexión u otro bloqueo. El informe no atribuye una causa sin evidencia.');
  } catch(error){report.fatal_error=String(error);$('status').textContent='La prueba no pudo completarse: '+error;}
  finally {busy=false;$('run').disabled=false;$('local').disabled=false;$('save').disabled=false;}
}
$('run').onclick=run;
$('save').onclick=()=>download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'resultados_releases.json');
$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('play').onclick=toggle;
$('state').onchange=()=>{state=Number($('state').value);index=0;playing=pack.sequences[state].frames.length>1;last=performance.now();show();};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)&&pack){e.preventDefault();toggle();}});
$('png').onclick=()=>{const image=pictures.get(pack.sequences[state].frames[index].asset);const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);c.toBlob(b=>{if(b)download(b,pack.sequences[state].name+'-'+(index+1)+'.png');},'image/png');};
$('local').onchange=async()=>{try{const file=$('local').files[0];if(!file)return;const checks=await validate(await file.arrayBuffer());log('Control manual correcto: '+checks.logical_frames+' frames. No valida alojamiento.');if(report)report.manual_control={ok:true,checks};$('status').textContent='Control manual correcto. La conclusión de la carga automática no cambia.';}catch(error){log('Control manual falló: '+error);if(report)report.manual_control={ok:false,error:String(error)};}};
try {const r=await fetch('config.json');if(!r.ok)throw new Error('HTTP '+r.status);config=await r.json();const match=location.hostname.match(/^([^.]+)\.github\.io$/);const project=location.pathname.split('/').filter(Boolean)[0];if(match&&project)$('repo').value=match[1]+'/'+project;}catch(error){$('run').disabled=true;$('local').disabled=true;$('status').textContent='No se pudo leer config.json. Publicá los archivos juntos o usá Iniciar.cmd; no abras index.html directamente.';}
