'use strict';
// Social Wars Asset Explorer v0.5.0 : navegador, sin framework ni servidor dinamico.
const $ = id => document.getElementById(id);
const PAGE_SIZE = 96;
const fmt = new Intl.NumberFormat('es-AR');
const number = n => fmt.format(Number(n || 0));
const normalize = val => String(val || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const itemNumber = item => Number((item.archivo || '').match(/^(\d+)/)?.[1] || 999999);
const create = (tag, cls='', content) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (content !== undefined) el.textContent = String(content);
  return el;
};
const el = {
  grid:$('asset-grid'),filters:$('filters'),search:$('search-input'),sort:$('sort-select'),sortDirection:$('sort-direction'),downloadFrame:$('download-frame'),
  size:$('size-input'),count:$('result-count'),more:$('load-more'),previewMode:$('preview-mode'),
  detail:$('detail'),back:$('detail-back'),
  title:$('detail-title'),file:$('detail-file'),swf:$('download-swf'),original:$('source-swf'),
  meta:$('detail-meta'),spriteGrid:$('sprite-grid'),spriteSearch:$('sprite-search'),
  animated:$('animated-only'),groupCount:$('sequence-count'),groupLabel:$('active-group'),
  stage:$('stage-image'),placeholder:$('stage-placeholder'),controls:$('viewer-controls'),
  warning:$('preview-warning'),range:$('frame-range'),frameCount:$('frame-count'),
  play:$('play'),previous:$('previous'),next:$('next'),fps:$('fps'),toast:$('toast'),
  debugStatus:$('debug-status'),
  columns:$('sprite-columns'),gallerySummary:$('gallery-summary'),stateSelect:$('state-select'),stateNote:$('state-note'),
};
const state={
  sortReversed:false,items:[],filtered:[],category:'Todos',debug:false,shown:0,current:null,
  detailData:null,group:-1,frame:0,timer:null,detailCache:new Map(),
  previousFocus:null,openRequest:0,overrides:{},previewMode:'walk',
  visibleCards:new Set(),cardTimer:null,cardTick:0,observer:null,cardEpoch:0,rotations:new Map(),rotationOrigin:performance.now(),animationFrame:null,actionFilter:-1,
};
function notify(message){
  el.toast.textContent=message;el.toast.hidden=false;
  clearTimeout(notify.timeout);
  notify.timeout=setTimeout(()=>{el.toast.hidden=true;},2600);
}
function clipAvailable(item){return Array.isArray(item.clip?.urls) && item.clip.urls.length>1;}
function hasFull(item){return item.preparacion==='completo';}
function hasAnyDetail(item){return Boolean(item.detalle);}
function realCoverFor(item){return state.overrides[item.id]?.url || item.miniatura;}
function hasManualCover(item){return Boolean(state.overrides[item.id] || item.portadaFuente==='curada');}
function viewsFor(item){return item.vistasEstaticas?.fotogramas || [];}
function viewFor(item,number){return viewsFor(item).find(frame=>frame.numero===number)?.url;}
function coverFor(item){
  if(state.previewMode==='icon')return item.icono || realCoverFor(item);
  if(['idle','walk','attack'].includes(state.previewMode)&&!hasManualCover(item))return item.previews?.[{idle:'quieto',walk:'andando',attack:'atacando'}[state.previewMode]]?.fotogramas?.[0]?.url||realCoverFor(item);
  if(hasManualCover(item))return realCoverFor(item);
  if(/^view[1-4]$/.test(state.previewMode))return viewFor(item,Number(state.previewMode.slice(4))) || realCoverFor(item);
  if(state.previewMode==='rotate')return rotationAvailable(item)?(viewFor(item,1) || realCoverFor(item)):realCoverFor(item);
  return realCoverFor(item);
}
// Initial rear view, then turn down five sides and return mirrored. At the rear
// endpoint the next step is 2, avoiding a duplicated 1 -> 1 pause each cycle.
const ROTATION_STEPS=[
  {numero:1,mirror:true},{numero:2,mirror:false},{numero:3,mirror:false},
  {numero:4,mirror:false},{numero:5,mirror:false},{numero:4,mirror:true},
  {numero:3,mirror:true},{numero:2,mirror:true},
];
function nextRotationIndex(index){return (index+1)%ROTATION_STEPS.length;}
function rotationPhaseAt(now,origin=state.rotationOrigin){
  const elapsed=Math.max(0,now-origin),index=Math.floor(elapsed/1250)%ROTATION_STEPS.length;
  const progress=Math.min(1,(elapsed%1250)/450);
  const blend=progress*progress*(3-2*progress);
  return {index,previous:(index+ROTATION_STEPS.length-1)%ROTATION_STEPS.length,blend};
}
function rotationAvailable(item){return !hasManualCover(item) && item.vistasEstaticas?.giroCompatible===true && viewsFor(item).length===5;}
// One animation clock and one progressive load per visible card/selected sequence.
function loading(parent,mode='loading',loaded=0,total=0){
  let badge=parent.querySelector('.load-indicator');
  if(!badge){badge=create('span','load-indicator');badge.setAttribute('role','status');parent.append(badge);}
  badge.hidden=mode==='ready';badge.classList.toggle('load-error',mode==='error');
  badge.textContent=mode==='error'?'!':'';badge.title=mode==='error'?'No se pudo completar la carga; volvé a seleccionar para reintentar.':'Cargando imágenes…';
  badge.setAttribute('aria-label',badge.title);parent.setAttribute('aria-busy',String(mode==='loading'));
  if(parent.id==='stage'){
    let count=parent.querySelector('.load-count');
    if(!count){count=create('span','load-count');parent.append(count);}
    count.hidden=mode!=='loading'||!total;
    count.textContent=total?`${number(loaded)}/${number(total)} frames cargados`:'';
    if(mode==='loading'&&total)badge.setAttribute('aria-label',count.textContent);
  }
}
function cancelLoad(load){if(!load)return;load.cancelled=true;load.controller.abort();clearTimeout(load.retry);load.ready.length=0;}
function progressive(parent,frames,priority,onFrame){
  const load={controller:new AbortController(),ready:[],loaded:new Set(),frames,cancelled:false,last:-1};loading(parent,'loading',0,frames.length);
  const start=()=>{if(load.cancelled)return;loading(parent,'loading',load.loaded.size,frames.length);
    SWMedia.prepare(frames,(im,i)=>{if(load.cancelled)return;load.ready[i]=im;load.loaded.add(i);loading(parent,'loading',load.loaded.size,frames.length);onFrame(load,i);},{priority,signal:load.controller.signal})
    .then(()=>{if(!load.cancelled)loading(parent,'ready');})
    .catch(e=>{if(load.cancelled)return;
      if(e.retryAt){loading(parent,'loading',load.loaded.size,frames.length);load.retry=setTimeout(start,Math.max(1000,e.retryAt-Date.now()+500));}
      else if(e.name==='AbortError'&&!load.retried){load.retried=true;load.retry=setTimeout(start,500);}
      else loading(parent,'error');
    });};start();return load;
}
function stopRotation(card){const r=state.rotations.get(card);if(r)cancelLoad(r);state.rotations.delete(card);}
function stopCards(){
  state.cardEpoch++;state.observer?.disconnect();state.observer=null;
  if(state.animationFrame!==null)cancelAnimationFrame(state.animationFrame);state.animationFrame=null;
  for(const card of [...state.rotations.keys()])stopRotation(card);state.visibleCards.clear();
}
function cardFrames(item){
  const action={idle:'quieto',walk:'andando',attack:'atacando'}[state.previewMode];
  if(action&&item.previews?.[action]?.fotogramas?.length)return {frames:SWMedia.frames(item.previews[action]),fps:item.previews[action].fps};
  if(state.previewMode==='rotate'&&rotationAvailable(item))return {frames:viewsFor(item),rotate:true};
  const url=coverFor(item);return {frames:url?[{url}]:[]};
}
function paintCard(r,index){
  const im=r.ready[index];if(!im||r.cancelled||r.last===index)return;
  SWMedia.paint(r.canvas,im,{...r.frames[index],crop:null,restore_mirror:false},null);r.last=index;
}
function rotationTick(now){
  state.animationFrame=null;if(document.hidden||state.current)return;
  for(const r of state.rotations.values()){
    if(r.rotate){const phase=rotationPhaseAt(now),step=ROTATION_STEPS[phase.index],prev=ROTATION_STEPS[phase.previous];
      const i=r.frames.findIndex(f=>f.numero===step.numero),j=r.frames.findIndex(f=>f.numero===prev.numero);
      if(!r.ready[i])continue;const ctx=r.canvas.getContext('2d');ctx.clearRect(0,0,r.canvas.width,r.canvas.height);
      const draw=(im,mirror,alpha)=>{if(!im)return;ctx.save();ctx.globalAlpha=alpha;const scale=Math.min(r.canvas.width/im.naturalWidth,r.canvas.height/im.naturalHeight),w=im.naturalWidth*scale,h=im.naturalHeight*scale;
        if(mirror){ctx.translate(r.canvas.width,0);ctx.scale(-1,1);}ctx.drawImage(im,(r.canvas.width-w)/2,(r.canvas.height-h)/2,w,h);ctx.restore();};
      draw(r.ready[j],prev.mirror,1-phase.blend);draw(r.ready[i],step.mirror,r.ready[j]?phase.blend:1);
    }else if(r.frames.length>1){const i=Math.floor((now-state.rotationOrigin)*r.fps/1000)%r.frames.length;paintCard(r,i);}
  }
  if(state.rotations.size)state.animationFrame=requestAnimationFrame(rotationTick);
}
function ensureRotationClock(){if(state.animationFrame===null)state.animationFrame=requestAnimationFrame(rotationTick);}
function startPreviewCard(card){
  if(state.rotations.has(card))return;const item=state.items.find(x=>x.id===card.dataset.id),spec=cardFrames(item),art=card.querySelector('.card-art');
  if(!spec.frames.length)return;const canvas=art.querySelector('canvas');
  const r=progressive(art,spec.frames,1,(load,i)=>{if(load.last<0){load.canvas=canvas;paintCard(load,i);}});
  Object.assign(r,spec,{canvas,fps:spec.fps||12});state.rotations.set(card,r);ensureRotationClock();
}
function startRotation(card){startPreviewCard(card);}
function observeCards(){
  stopCards();if(document.hidden||state.current)return;
  state.observer=new IntersectionObserver(entries=>{for(const entry of entries){
    if(entry.isIntersecting){state.visibleCards.add(entry.target);startPreviewCard(entry.target);}
    else{state.visibleCards.delete(entry.target);stopRotation(entry.target);}
  }},{rootMargin:'0px'});
  el.grid.querySelectorAll('.asset-card').forEach(card=>state.observer.observe(card));
}
function renderFilters(){
  const counts=new Map();
  for(const item of state.items)counts.set(item.categoria||'Sin clasificar',(counts.get(item.categoria||'Sin clasificar')||0)+1);
  const order=['Unidades','Edificios','Colecciones','Recursos','Sin clasificar','Terreno'];
  const extras=[...counts.keys()].filter(x=>!order.includes(x)).sort((a,b)=>a.localeCompare(b,'es'));
  const groups=[['Todos',state.items.length],...[...order,...extras].map(name=>[name,counts.get(name)||0])];
  el.filters.replaceChildren();
  for(const [category,count] of groups){
    const btn=create('button','filter'+(state.category===category?' active':''));
    btn.type='button';btn.setAttribute('aria-pressed',String(state.category===category));
    btn.append(create('span','',category),create('span','filter-count',number(count)));
    btn.addEventListener('click',()=>{state.category=category;renderFilters();updateMatches();});
    el.filters.append(btn);
  }
  const ready=state.items.filter(hasFull).length;
  el.debugStatus.textContent=`Depuración · ${number(ready)} / ${number(state.items.length)} recursos con secuencias completas`;
  el.debugStatus.hidden=!state.debug;
}
function showEmpty(message,description){
  el.grid.replaceChildren();
  const box=create('div','empty');box.append(create('strong','',message),create('span','',description));
  el.grid.append(box);el.more.hidden=true;
}
function cardFor(item){
  const card=create('button','asset-card');card.type='button';card.dataset.id=item.id;
  card.title=`${item.nombre} : ${item.archivo}`;
  card.setAttribute('aria-label',`Abrir ${item.nombre}`);
  const art=create('div','card-art');
  const cover=coverFor(item);
  if(state.previewMode==='icon'&&!item.icono)art.title='Sin ícono histórico; se muestra el render del objeto.';
  if(cover||Object.keys(item.previews||{}).length){const canvas=create('canvas');canvas.width=220;canvas.height=220;canvas.setAttribute('aria-label','Preview del recurso');art.append(canvas);loading(art);}else art.append(create('span','no-art','Sin imagen'));
  if(state.previewMode!=='icon'&&hasManualCover(item))art.title='Portada elegida manualmente; se conserva en las vistas estáticas.';
  const id=itemNumber(item);
  if(id!==999999)art.append(create('span','card-id',String(id).padStart(4,'0')));
  if(hasFull(item)){
    const m=create('span','card-motion','▶');m.title='Fotogramas completos preparados';art.append(m);

  }
  const cap=create('div','card-caption');cap.append(create('span','card-name',item.nombre));
  const sub=create('div','card-sub');
  sub.append(create('span','',item.categoria||'Sin clasificar'),create('span','',`${number(item.imagenes)} ${item.ui?'frames':'PNG'}`));
  cap.append(sub);card.append(art,cap);
  card.addEventListener('click',()=>openItem(item,true));
  return card;
}
function appendPage(){
  const batch=state.filtered.slice(state.shown,state.shown+PAGE_SIZE);
  const frag=document.createDocumentFragment();
  for(const item of batch)frag.append(cardFor(item));
  el.grid.append(frag);state.shown+=batch.length;
  el.more.hidden=state.shown>=state.filtered.length;
  el.more.textContent=`Mostrar más (${number(state.filtered.length-state.shown)})`;
  el.count.textContent=`${number(state.filtered.length)} recursos`;
  observeCards();
}
function updateMatches(){
  const words=normalize(el.search.value).trim().split(/\s+/).filter(Boolean);
  state.filtered=state.items.filter(item=>{
    if(state.category!=='Todos' && (item.categoria||'Sin clasificar')!==state.category)return false;
    const text=normalize(`${item.nombre} ${item.archivo} ${item.carpeta||''} ${item.tipo||''} ${item.origen||''} ${item.busqueda||''}`);
    return words.every(word=>text.includes(word));
  });
  if(el.sort.value==='id')state.filtered.sort((a,b)=>itemNumber(a)-itemNumber(b)||a.nombre.localeCompare(b.nombre,'es'));
  else if(el.sort.value==='size')state.filtered.sort((a,b)=>b.imagenes-a.imagenes || a.nombre.localeCompare(b.nombre,'es'));
  else state.filtered.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es',{numeric:true}));
  if(state.sortReversed)state.filtered.reverse();
  updateSortDirection();
  stopCards();state.shown=0;el.grid.replaceChildren();
  if(!state.filtered.length){showEmpty('Sin resultados','Probá con otro nombre, número o categoría.');el.count.textContent='0 recursos';}
  else appendPage();
}
function setPlayIcon(playing){
  el.play.innerHTML=playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3 L21 12 L6 21 Z"/></svg>';
  el.play.setAttribute('aria-label',playing?'Pausar':'Recorrer fotogramas preparados');
}
function stopPlayback(){
  if(state.timer!==null)clearInterval(state.timer);
  state.timer=null;setPlayIcon(false);
}
function groupNow(){return state.previewGroup||state.detailData?.groups?.[state.group]||null;}
function framesNow(){
  const group=groupNow(),frames=group?.fotogramas||[];
  const selected=state.detailData?.estados?.[state.actionFilter];
  return selected?.gruposPrincipal.includes(group?.clave)?frames.filter(f=>f.numero>=selected.desde&&f.numero<=selected.hasta):frames;
}
function isViewSample(group){
  if(group?.curada)return false;
  const selected=state.detailData?.estados?.[state.actionFilter];
  if(selected?.gruposPrincipal.includes(group?.clave))return true;
  return group?.clave===state.current?.vistasEstaticas?.grupo && group.fotogramas.length<=5
    && group.fotogramas.every(frame=>frame.numero>=1&&frame.numero<=5);
}
function canPlay(group){return group?.completo===true && group.fotogramas.length>1 && !isViewSample(group);}

let renderEpoch=0,stageLoad=null,stageIdentity=null;
function clearStage(){renderEpoch++;cancelLoad(stageLoad);stageLoad=null;stageIdentity=null;
  $('download-gif').disabled=true;
  loading($('stage'),'ready');
  el.stage.hidden=true;el.stage.removeAttribute('src');const canvas=$('stage-canvas');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.hidden=true;
  el.placeholder.hidden=true;el.downloadFrame.disabled=true;
}
function stageSequence(frames,identity,group){
  if(stageIdentity===identity)return;clearStage();stageIdentity=identity;const canvas=$('stage-canvas');canvas.hidden=false;
  if(!frames.length){el.placeholder.hidden=false;loading($('stage'),'ready');return;}
  const request=renderEpoch;
  stageLoad=progressive($('stage'),frames,0,(load,i)=>{if(request!==renderEpoch)return;
    if(load.last<0||i===state.frame){SWMedia.paint(canvas,load.ready[i],frames[i],group);load.last=i;el.downloadFrame.disabled=false;}
  });
}
function showStage(url){
  stageSequence(url?[{url}]:[],url,null);
}
function updateFrame(){
  const group=groupNow(),frames=framesNow();
  state.frame=frames.length?Math.max(0,Math.min(state.frame,frames.length-1)):0;
  const f=frames[state.frame];
  if(f){
    stageSequence(frames,group?.clave+':'+state.group+':'+state.actionFilter+':'+(state.previewGroup?.nombre||''),group);
    const im=stageLoad?.ready[state.frame];if(im){SWMedia.paint($('stage-canvas'),im,f,group);stageLoad.last=state.frame;el.downloadFrame.disabled=false;}
  }else showStage((state.actionFilter>=0?null:realCoverFor(state.current))||null);
  el.controls.hidden=!frames.length;
  el.frameCount.textContent=frames.length?`${number(state.frame+1)} / ${number(frames.length)} preparados`:'Vista previa';
  el.range.max=String(Math.max(0,frames.length-1));el.range.value=String(state.frame);
  const browsable=frames.length>1;
  const playable=canPlay(group);
  el.previous.disabled=el.next.disabled=el.range.disabled=!browsable;
  el.play.disabled=!playable;
  el.fps.hidden=!playable;
  el.warning.hidden=!state.debug;
  $('download-gif').disabled=!!$('download-gif').dataset.busy||frames.length<2;
  if(group){
    const originals=number(group.total),prepared=number(frames.length);
    if(isViewSample(group)){
      el.warning.textContent=`Vistas estáticas del símbolo principal: ${prepared} imágenes preparadas de ${originals} fotogramas originales. Podés recorrerlas; no se reproducen como movimiento.`;
      el.play.title='Selección de vistas estáticas; usá las flechas o el deslizador.';
    }else if(group.completo){
      el.warning.textContent=`Exportación completa: ${prepared} de ${originals} fotogramas originales preparados. Play recorre los fotogramas; no identifica una acción de andar o atacar.`;
      el.play.title=playable?'Recorrer fotogramas preparados; no garantiza una animación del juego.':'Un solo fotograma: no hay secuencia que reproducir.';
    }else{
      el.warning.textContent=`Muestra parcial: ${prepared} de ${originals} fotogramas originales preparados. Play deshabilitado porque faltan fotogramas en esta galería.`;
      el.play.title='Muestra parcial: faltan fotogramas originales en la web.';
    }
  }else{
    el.warning.textContent='Solo hay una portada preparada. Podés consultar o descargar el SWF original.';
    el.play.title='Sin grupo de fotogramas preparado.';
  }

}
function changeFrame(offset){const frames=framesNow();if(!frames.length)return;state.frame=(state.frame+offset+frames.length)%frames.length;updateFrame();}
function togglePlayback(){
  if(state.timer!==null){stopPlayback();return;}
  if(!canPlay(groupNow()))return;
  setPlayIcon(true);
  state.timer=setInterval(()=>changeFrame(1),1000/Number(el.fps.value));
}
function groupShort(name){
  if(name==='Imagenes base')return 'Imágenes base';
  const match=name.match(/^DefineSprite_(\d+)/i);
  return match?`Sprite ${match[1]}`:name;
}
function chooseGroup(index, initialFrame=0, autoplay=false){
  stopPlayback();clearStage();state.previewGroup=null;state.group=index;state.frame=initialFrame;
  const group=groupNow();el.groupLabel.textContent=group?.nombre||'Miniatura';
  el.spriteGrid.querySelectorAll('.sprite-cell').forEach(btn=>{
    const selected=Number(btn.dataset.index)===index;
    btn.classList.toggle('selected',selected);btn.setAttribute('aria-pressed',String(selected));
  });
  updateFrame();
  if(autoplay&&canPlay(group))togglePlayback();
}
function renderSprites(){
  const groups=state.detailData?.groups||[];
  const q=normalize(el.spriteSearch.value.trim());
  const multiple=el.animated.checked;
  const selectedState=state.detailData?.estados?.[state.actionFilter]||null;
  const visibleIndices=[];
  cancelThumbs();el.spriteGrid.replaceChildren();let count=0;
  const fragment=document.createDocumentFragment();
  groups.forEach((group,index)=>{
    if(q&&!normalize(group.nombre).includes(q)&&!normalize(groupShort(group.nombre)).includes(q))return;
    if(multiple&&group.total<2)return;
    if(selectedState&&!selectedState.grupos.includes(group.clave)&&!(selectedState.gruposPrincipal.includes(group.clave)&&group.fotogramas.some(f=>f.numero>=selectedState.desde&&f.numero<=selectedState.hasta)))return;
    visibleIndices.push(index);count++;
    const btn=create('button','sprite-cell'+(index===state.group?' selected':''));
    btn.type='button';btn.dataset.index=String(index);btn.title=group.nombre;
    btn.setAttribute('aria-pressed',String(index===state.group));
    const thumb=create('div','sprite-thumb');
    const f=group.thumbnail?{...group.thumbnail,pack:state.detailData.thumbnailPack}:group.fotogramas[0];
    if(f){const canvas=create('canvas');canvas.width=220;canvas.height=220;thumb.append(canvas);lazyFrame(canvas,f);}
    const counts=create('small');
    if(state.debug)counts.append(create('span','',`${number(group.fotogramas.length)} en web`),create('span','',`${number(group.total)} ${group.total===1?'original':'originales'}`));
    else counts.append(create('span','',`${number(group.fotogramas.length)} frames`));
    btn.title=`${group.nombre} · ${number(group.fotogramas.length)} de ${number(group.total)} fotogramas preparados · ${group.completo?'Completo':'Muestra parcial'}`;
    btn.append(thumb,create('strong','',groupShort(group.nombre)),counts);
    btn.addEventListener('click',()=>chooseGroup(index,0,true));
    fragment.append(btn);
  });
  el.spriteGrid.append(fragment);
  if((state.group<0&&visibleIndices.length)||(state.group>=0&&!visibleIndices.includes(state.group)))chooseGroup(visibleIndices[0]??-1,0,false);
  if(!count)el.spriteGrid.append(create('p','empty-sprites',selectedState?'No hay grupos preparados vinculados a este estado con los filtros actuales.':groups.length?'No hay grupos con ese filtro.':'Sin vistas de sprites preparadas.'));
  el.groupCount.textContent=`${number(count)} / ${number(groups.length)} grupos`;
  const prepared=groups.reduce((sum,g)=>sum+g.fotogramas.length,0);
  el.gallerySummary.textContent=`${number(prepared)} imágenes web`;
  el.gallerySummary.title=`${number(prepared)} imágenes preparadas de ${number(groups.reduce((sum,g)=>sum+g.total,0))} fotogramas originales inventariados en los grupos.`;
}
function prepareStates(){
  const states=state.detailData?.estados||[];state.actionFilter=-1;
  const all=create('option','','Todos');all.value='all';el.stateSelect.replaceChildren(all);
  states.forEach((item,index)=>{const option=create('option','',item.etiqueta);option.value=String(index);el.stateSelect.append(option);});
  el.stateSelect.value='all';el.stateSelect.disabled=!states.length;
  el.stateNote.textContent=state.current?.ui?(state.detailData.nota||'Interfaz original del juego.'):states.length?'Etiquetas del SWF y referencias estructurales; no certifican animaciones.':'Sin etiquetas disponibles en el símbolo principal auditado.';
}
function preparePreviews(){
  const buttons=$('preview-buttons');buttons.replaceChildren();
  for(const [action,preview] of Object.entries(state.detailData?.previews||{})){
    const b=create('button','',action);b.type='button';b.addEventListener('click',()=>{
      stopPlayback();clearStage();state.actionFilter=-1;el.stateSelect.value='all';
      state.previewGroup={nombre:action,clave:preview.grupo,total:preview.fotogramas.length,completo:true,fotogramas:SWMedia.frames(preview),curada:true};
      if(![...el.fps.options].some(o=>o.value===String(preview.fps))){const o=create('option','',preview.fps);o.value=String(preview.fps);el.fps.append(o);}
      el.fps.value=String(preview.fps);state.frame=0;el.groupLabel.textContent=action+' · preview seleccionada';updateFrame();if(canPlay(state.previewGroup))togglePlayback();
    });buttons.append(b);
  }buttons.hidden=!buttons.children.length;
}
const thumbLoads=new Map(),thumbPending=new Map();
const lazyObserver=new IntersectionObserver(entries=>{for(const entry of entries){const target=entry.target;
  if(entry.isIntersecting&&!thumbLoads.has(target)){
    const f=thumbPending.get(target);if(!f)continue;
    const load=progressive(target.parentElement,[f],2,(l,i)=>{if(target.isConnected)SWMedia.paint(target,l.ready[i],{...f,crop:null},null);});thumbLoads.set(target,load);
  }else if(!entry.isIntersecting&&thumbLoads.has(target)){cancelLoad(thumbLoads.get(target));thumbLoads.delete(target);}
}},{rootMargin:'0px'});
function cancelThumbs(){lazyObserver.disconnect();for(const load of thumbLoads.values())cancelLoad(load);thumbLoads.clear();thumbPending.clear();}
function lazyFrame(target,frame){thumbPending.set(target,frame);loading(target.parentElement);lazyObserver.observe(target);}

function fillDetails(){
  const groups=state.detailData?.groups||[];
  el.spriteSearch.value='';el.animated.checked=false;prepareStates();preparePreviews();
  const stem=state.current.archivo.replace(/\.swf$/i,'').toLowerCase();
  let preferred=groups.findIndex(g=>g.clave?.toLowerCase().endsWith('_'+stem) && g.fotogramas.length);
  if(preferred<0)preferred=groups.findIndex(g=>g.fotogramas.length);
  const selected=state.overrides[state.current.id] || {grupo:state.current.portadaGrupo,fotograma:state.current.portadaFotograma};
  const coverGroup=groups.findIndex(g=>g.clave===selected.grupo && g.fotogramas.length);
  if(coverGroup>=0)preferred=coverGroup;
  const frame=groups[preferred]?.fotogramas.findIndex(f=>f.numero===selected.fotograma) ?? -1;
  state.group=preferred;renderSprites();chooseGroup(preferred,Math.max(0,frame));
}
async function openItem(item,updateUrl){
  stopPlayback();stopCards();clearStage();cancelThumbs();
  state.previousFocus=document.activeElement;
  state.previewGroup=null;state.current=item;state.detailData=null;state.group=-1;state.frame=0;
  const request=++state.openRequest;
  el.detail.hidden=false;document.body.classList.add('inspector-open');
  el.title.textContent=item.nombre;el.file.textContent=item.archivo;
  el.meta.textContent=item.ui?`${item.tipo} · ${item.origen} · resolución original`:`${number(item.imagenes)} PNG originales · ${number(item.grupos)} sprites`;
  $('quality-tip').textContent=item.ui?'La interfaz conserva su resolución original y usa compresión sin pérdida. PNG descarga esa resolución. GIF genera una copia a 220 px; el SWF conserva el original.':'Las imágenes se muestran a 220 px para reducir el peso y acelerar la carga. Al ampliarlas pueden verse pixeladas. Las descargas PNG y GIF usan esa misma resolución; el SWF conserva el archivo original.';
  $('detail-source-note').textContent=item.ui?'Interfaz a resolución original. Las composiciones pueden contener textos de ejemplo o espacios que el juego completa.':'Galería completa a 220 px. Varios fotogramas pueden ser direcciones o estados.';
  el.groupLabel.textContent=item.portadaFuente==='juego'?'Miniatura original del juego':'Miniatura';
  el.groupCount.textContent=item.detalle?'Cargando…':'Solo miniatura';
  el.spriteGrid.replaceChildren(create('p','empty-sprites',item.detalle?'Cargando galería…':'Este elemento solo tiene miniatura preparada.'));
  el.gallerySummary.textContent='';el.stateSelect.disabled=true;el.stateNote.textContent='Cargando etiquetas...';
  el.controls.hidden=true;el.warning.hidden=!state.debug;
  el.warning.textContent=item.detalle?'Cargando fotogramas preparados…':'No se preparó el índice de sprites de este recurso.';
  showStage(realCoverFor(item));
  el.swf.hidden=!(item.swf||item.swfDescarga);
  el.swf.dataset.url=item.swf||item.swfDescarga||'';
  el.original.href=item.swfGithub||'https://github.com/AcidCaos/socialwarriors';
  if(updateUrl){const u=new URL(location.href);u.searchParams.set('asset',item.id);history.pushState({asset:item.id},'',u);}
  el.back.focus();
  if(!item.detalle)return;
  try{
    let data=state.detailCache.get(item.id);
    if(!data){data=await SWMedia.json(item.detalle+'?v=0.5.5');state.detailCache.set(item.id,data);while(state.detailCache.size>12)state.detailCache.delete(state.detailCache.keys().next().value);}
    if(request!==state.openRequest||state.current?.id!==item.id)return;
    if(!Array.isArray(data.groups))throw new Error('Formato de galería no válido');
    SWMedia.register(data);state.detailData=data;fillDetails();
  }catch(error){
    if(request!==state.openRequest)return;
    console.error('No se pudo abrir el detalle',error);
    el.spriteGrid.replaceChildren(create('p','empty-sprites','No se pudo abrir la galería. Revisá docs/data/items.'));
    el.groupCount.textContent='Error';
    el.warning.textContent='Error al cargar la galería; el SWF original sigue disponible.';
  }
}
function closeItem(updateUrl=true){
  stopPlayback();clearStage();cancelThumbs();++state.openRequest;state.current=null;state.detailData=null;state.group=-1;
  el.detail.hidden=true;document.body.classList.remove('inspector-open');
  if(updateUrl){const u=new URL(location.href);u.searchParams.delete('asset');history.pushState({},'',u);}
  if(state.previousFocus?.isConnected)state.previousFocus.focus();
  observeCards();
}
function route(){
  const id=new URL(location.href).searchParams.get('asset');
  if(!id){if(state.current)closeItem(false);return;}
  const item=state.items.find(x=>x.id===id);
  if(item && state.current?.id!==id)openItem(item,false);
}
function updateSortDirection(){
  const descending=(el.sort.value==='size')!==state.sortReversed;
  const label=descending?'Orden descendente':'Orden ascendente';
  el.sortDirection.title=label+'; clic para invertir';el.sortDirection.setAttribute('aria-label',label+'; invertir orden');
  el.sortDirection.setAttribute('aria-pressed',String(state.sortReversed));
  el.sortDirection.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3 H14 V13 H19 L12 21 L5 13 H10 Z"/></svg>';
  el.sortDirection.classList.toggle('ascending',!descending);
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),anchor=create('a');anchor.href=url;anchor.download=filename;
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function safeFilename(value){return String(value||'recurso').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');}
function applyProjectRepo(value){
  const button=$('support-repo');button.hidden=true;button.removeAttribute('href');
  try{
    const url=new URL(String(value||''));
    if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname))return false;
    url.search='';url.hash='';button.href=url.href;button.hidden=false;return true;
  }catch{return false;}
}
async function configureProject(){
  try{
    const response=await fetch('proyecto.json',{cache:'no-store'});
    if(response.ok){const config=await response.json();if(applyProjectRepo(config.repositorio))return;}
  }catch{}
  // Standard project Pages URL identifies its repository, without assuming a user name.
  const url=new URL(location.href),match=url.hostname.match(/^([A-Za-z0-9-]+)\.github\.io$/);
  const repo=url.pathname.split('/').filter(Boolean)[0];
  if(match&&repo)applyProjectRepo('https://github.com/'+match[1]+'/'+repo);
}
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function zipSingleFile(bytes,filename){
  const name=new TextEncoder().encode(filename);
  if(name.length>65535||bytes.length>0xffffffff)throw new Error('Archivo demasiado grande para este ZIP');
  const checksum=crc32(bytes),local=new Uint8Array(30+name.length),central=new Uint8Array(46+name.length),end=new Uint8Array(22);
  const l=new DataView(local.buffer),c=new DataView(central.buffer),e=new DataView(end.buffer);
  // Stored ZIP entry preserves original bytes without an extra compression dependency.
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(12,33,true);
  l.setUint32(14,checksum,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,name.length,true);local.set(name,30);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,33,true);
  c.setUint32(16,checksum,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);central.set(name,46);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,1,true);e.setUint16(10,1,true);e.setUint32(12,central.length,true);e.setUint32(16,local.length+bytes.length,true);
  return new Blob([local,bytes,central,end],{type:'application/zip'});
}
async function downloadSwf(){
  const item=state.current,url=el.swf.dataset.url;
  if(!item||!url||el.swf.dataset.busy)return;
  const button=el.swf;button.dataset.busy='1';button.disabled=true;button.textContent='SWF…';
  try{
    const response=await fetch(url);if(!response.ok)throw new Error('HTTP '+response.status);
    const blob=await response.blob(),bytes=new Uint8Array(await blob.slice(0,3).arrayBuffer());
    const signature=String.fromCharCode(...bytes);
    if(!['FWS','CWS','ZWS'].includes(signature))throw new Error('La respuesta no contiene un SWF válido');
    const filename=safeFilename(item.archivo);
    downloadBlob(zipSingleFile(new Uint8Array(await blob.arrayBuffer()),filename),filename.replace(/\.swf$/i,'')+'.zip');
    notify('Descarga del ZIP con el SWF original solicitada');
  }catch(error){console.error('Descarga SWF',error);notify('No se pudo descargar el SWF. Revisá tu conexión o el archivo de origen.');}
  finally{delete button.dataset.busy;button.disabled=false;button.textContent='SWF (ZIP)';}
}
async function downloadCurrentFrame(){
  const item=state.current,group=groupNow(),frame=framesNow()[state.frame]||stageLoad?.frames[0];
  if(!item||!frame||el.downloadFrame.dataset.busy)return;
  const filename=safeFilename(item.archivo.replace(/\.swf$/i,''))+'_'+safeFilename(group?.clave||'portada')+'_'+(frame?.numero||'vista')+'.png';
  const button=el.downloadFrame;button.dataset.busy='1';button.disabled=true;button.textContent='PNG…';
  try{downloadBlob(await SWMedia.png(frame),filename);notify('Descarga del fotograma solicitada');}
  catch(error){console.error('Descarga PNG',error);notify('No se pudo descargar el fotograma.');}
  finally{delete button.dataset.busy;button.disabled=!stageLoad?.ready.some(Boolean);button.textContent='PNG';}
}
async function downloadCurrentGif(){
  const button=$('download-gif');if(button.dataset.busy)return;
  const item=state.current,frames=framesNow();if(!item||frames.length<2)return;
  const snapshot=JSON.parse(JSON.stringify(frames)),group=JSON.parse(JSON.stringify(groupNow()||{})),fps=Number(el.fps.value)||12;
  const filename=safeFilename(item.archivo.replace(/\.swf$/i,''))+'_'+safeFilename(group.nombre||group.clave||'animacion')+'_'+fps+'fps.gif';
  button.dataset.busy='1';button.disabled=true;
  try{const blob=await SWGIF.exportSequence(snapshot,group,fps,(done,total,phase)=>{button.textContent=`GIF ${done}/${total}`;button.title=`${phase} GIF: ${done}/${total} frames`;});downloadBlob(blob,filename);notify('Descarga del GIF animado solicitada');}
  catch(error){console.error('Descarga GIF',error);notify('No se pudo completar el GIF. Revisá la conexión y volvé a intentar; no se descargó un archivo parcial.');}
  finally{delete button.dataset.busy;button.textContent='GIF';button.title='Descargar la secuencia seleccionada como GIF animado a los FPS elegidos';button.disabled=!state.current||framesNow().length<2;}
}
function setupEvents(){
  configureProject();
  setPlayIcon(false);
  el.stateSelect.addEventListener('change',()=>{
    state.previewGroup=null;state.actionFilter=el.stateSelect.value==='all'?-1:Number(el.stateSelect.value);
    const selected=state.detailData?.estados?.[state.actionFilter];
    el.stateNote.textContent=selected?(selected.vacio?'Estado sin símbolos visibles en la auditoría.':`Fotogramas ${selected.desde} a ${selected.hasta} del símbolo principal. Se muestran sus grupos y componentes anidados.`):'Etiquetas del SWF y referencias estructurales; no certifican animaciones.';
    stopPlayback();state.frame=0;renderSprites();updateFrame();
  });
  el.columns.addEventListener('change',()=>{
    const columns=Number(el.columns.value);
    if(![2,3,4].includes(columns))return;
    el.spriteGrid.style.setProperty('--sprite-columns',String(columns));
    try{localStorage.setItem('sw-sprite-columns',String(columns));}catch{}
  });
  el.search.addEventListener('input',updateMatches);
  el.sort.addEventListener('change',updateMatches);
  el.sortDirection.addEventListener('click',()=>{state.sortReversed=!state.sortReversed;updateMatches();});
  el.swf.addEventListener('click',downloadSwf);
  el.downloadFrame.addEventListener('click',downloadCurrentFrame);
  $('download-gif').addEventListener('click',downloadCurrentGif);
  $('quality-help').addEventListener('click',()=>{$('quality-help').parentElement.classList.toggle('is-open');});
  updateSortDirection();
  el.more.addEventListener('click',appendPage);
  el.size.addEventListener('input',()=>{
    document.documentElement.style.setProperty('--grid-size',el.size.value+'px');
    try{localStorage.setItem('sw-grid-size-v04',el.size.value);}catch{}
  });
  el.previewMode.addEventListener('change',()=>{
    state.previewMode=['static','view1','view2','view3','view4','rotate','icon','idle','walk','attack'].includes(el.previewMode.value)?el.previewMode.value:'static';
    updateMatches();
  });
  el.back.addEventListener('click',()=>closeItem());
  $('copy-link').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(location.href);notify('Enlace copiado');}
    catch{window.prompt('Copiá el enlace:',location.href);}
  });
  el.previous.addEventListener('click',()=>{stopPlayback();changeFrame(-1);});
  el.next.addEventListener('click',()=>{stopPlayback();changeFrame(1);});
  el.play.addEventListener('click',togglePlayback);
  el.range.addEventListener('input',()=>{stopPlayback();state.frame=Number(el.range.value);updateFrame();});
  el.fps.addEventListener('change',()=>{if(state.timer!==null){stopPlayback();togglePlayback();}});
  el.spriteSearch.addEventListener('input',renderSprites);
  el.animated.addEventListener('change',renderSprites);
  window.addEventListener('popstate',route);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopPlayback();stopCards();}else observeCards();});
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey&&event.altKey&&!event.shiftKey&&!event.repeat&&event.code==='KeyD'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)&&!event.target.isContentEditable){
      event.preventDefault();state.debug=!state.debug;document.body.classList.toggle('debug-mode',state.debug);renderFilters();
      if(state.current&&state.detailData){renderSprites();updateFrame();}return;
    }
    if(event.key==='Escape'&&state.current){closeItem();return;}
    if(state.current&&(event.code==='Space'||event.key===' ')&&!event.repeat){
      const tag=event.target.tagName;
      if(!['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(tag)&&!event.target.isContentEditable&&canPlay(groupNow())){event.preventDefault();togglePlayback();return;}
    }
    if(state.current&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){
      if(event.key==='ArrowLeft'){stopPlayback();changeFrame(-1);}
      if(event.key==='ArrowRight'){stopPlayback();changeFrame(1);}
    }
  });
}
async function start(){
  setupEvents();
  try{
    const size=Number(localStorage.getItem('sw-grid-size-v04'));
    if(size>=130&&size<=270){el.size.value=String(size);document.documentElement.style.setProperty('--grid-size',size+'px');}
    const columns=Number(localStorage.getItem('sw-sprite-columns'));
    if([2,3,4].includes(columns)){el.columns.value=String(columns);el.spriteGrid.style.setProperty('--sprite-columns',String(columns));}
    const saved=JSON.parse(localStorage.getItem('sw-covers-v041')||'{}');
    if(saved && typeof saved==='object')state.overrides=saved;
  }catch{}
  try{
    const data=await SWMedia.json('data/catalog.json?v=0.5.5');
    if(!Array.isArray(data.items))throw new Error('Catálogo inválido');
    let ui=[];
    try{const supplement=await SWMedia.json('data/ui/catalog.json?v=0.5.5');if(!Array.isArray(supplement.items))throw Error('Catálogo de interfaz inválido');ui=supplement.items;}
    catch(error){console.warn('Interfaz adicional no disponible',error);}
    const merged=new Map(data.items.map(item=>[item.id,item]));
    for(const item of ui)if(item.ui===true&&item.categoria==='Interfaz'&&!merged.has(item.id))merged.set(item.id,item);
    state.items=[...merged.values()];
    if(!state.items.length){showEmpty('Catálogo todavía vacío','Ejecutá generar_explorador.py para generar tus datos.');el.count.textContent='Sin catálogo';return;}
    renderFilters();updateMatches();route();
  }catch(error){
    console.error('No se pudo cargar el catalogo',error);
    showEmpty('No se pudo cargar el catálogo','Revisá la carpeta docs/data y el servidor local.');
    el.count.textContent='Error de catálogo';
  }
}
start();

window.addEventListener('sw-network-wait',event=>{notify('El servidor pidió una pausa. Se conservan las imágenes cargadas y se reintentará después.');});
