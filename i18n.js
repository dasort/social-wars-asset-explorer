'use strict';
/**
 * Social Wars Asset Explorer
 *
 * Desarrollado por Lucas Bonifacio (dasort).
 * Proyecto independiente de preservación de recursos
 * del videojuego Social Wars.
 *
 * Repositorio original:
 * https://github.com/dasort/social-wars-asset-explorer
 *
 * Los recursos originales del juego pertenecen
 * a sus respectivos titulares.
 */
// Text-only localization adapter for the existing DOM. Never rebuilds the explorer.
window.SWI18n=(()=>{
 const languages=[['es','ES','Español','es'],['en','EN','English','us'],['pt-BR','PT','Português (Brasil)','br'],['tr','TR','Türkçe','tr']];
 const rows=window.SWTranslations,exact=new Map(),patterns=[],bindings=new WeakMap();
 const attributes=['title','aria-label','placeholder','alt','content'];
 let language='es',observer,updating=false;
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const row of rows){
  if(!row[0].includes('{')){exact.set(row[0],row);continue;}
  const vars=[];let start=0,pattern='^';
  for(const m of row[0].matchAll(/\{(\w+)(:ui)?\}/g)){
   pattern+=escape(row[0].slice(start,m.index));pattern+=/^(n|a|b)$/.test(m[1])?'([\\d.]+)':'(.+?)';vars.push([m[1],!!m[2]]);start=m.index+m[0].length;
  }
  pattern+=escape(row[0].slice(start))+'$';patterns.push({row,vars,regex:new RegExp(pattern)});
 }
 patterns.sort((a,b)=>b.row[0].replace(/\{[^}]+\}/g,'').length-a.row[0].replace(/\{[^}]+\}/g,'').length);
 const canonical=value=>String(value).replace(/\s*[\u00b7\u2013\u2014]\s*/g,', ');
 function resolve(value,lang=language){
  value=canonical(value);
  const index=languages.findIndex(x=>x[0]===lang),row=exact.get(value);
  if(row)return row[index]||row[0];
  for(const entry of patterns){const m=value.match(entry.regex);if(!m)continue;
   const vars={};entry.vars.forEach(([key,ui],i)=>{vars[key]=ui?resolve(m[i+1],lang):/^(n|a|b)$/.test(key)?new Intl.NumberFormat(lang).format(Number(m[i+1].replace(/\./g,''))):m[i+1];});
   return (entry.row[index]||entry.row[0]).replace(/\{(\w+)(?::ui)?\}/g,(_,key)=>vars[key]);
  }return value;
 }
 function eligible(node){
  const parent=node.nodeType===3?node.parentElement:node;
  return parent&&!parent.closest('script,style,[translate="no"]')&&!(node.nodeType===3&&parent.hasAttribute('data-original-text'));
 }
 function update(node,attribute){
  if(!eligible(node))return;
  const current=attribute?node.getAttribute(attribute):node.nodeValue;
  if(!current)return;
  let saved=bindings.get(node);if(!saved){saved={};bindings.set(node,saved);}
  const key=attribute||'text',old=saved[key];
  const source=old&&old.rendered===current?old.source:current;
  const leading=source.match(/^\s*/)[0],trailing=source.match(/\s*$/)[0],trimmed=source.trim();
  let translated=resolve(trimmed);
  const name=attribute==='title'&&node.dataset?.uiTitleName?canonical(node.dataset.uiTitleName):null;
  if(name&&translated.startsWith(name))translated=resolve(name)+translated.slice(name.length);
  const rendered=leading+translated+trailing;
  saved[key]={source,rendered};
  if(rendered!==current){if(attribute)node.setAttribute(attribute,rendered);else node.nodeValue=rendered;}
 }
 function scan(root){
  if(root.nodeType===3){update(root);return;}
  if(root.nodeType!==1)return;
  for(const attr of attributes)if(root.hasAttribute(attr))update(root,attr);
  for(const child of root.childNodes)scan(child);
 }
 function watch(){observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});}
 function refresh(){
  if(updating)return;updating=true;observer?.disconnect();
  scan(document.documentElement);document.documentElement.lang=language;
  for(const selector of document.querySelectorAll('.language-selector')){
   const info=languages.find(x=>x[0]===language),button=selector.querySelector('.language-toggle');if(!button)continue;
   button.querySelector('img').src='flags/'+info[3]+'.png';button.querySelector('.language-code').textContent=info[1];button.setAttribute('aria-label',resolve('Cambiar idioma')+': '+info[2]);
   for(const option of selector.querySelectorAll('[data-language]'))option.setAttribute('aria-checked',String(option.dataset.language===language));
  }
  watch();updating=false;
 }
 function normalizeLanguage(value){
  const code=String(value||'').toLowerCase().split('-')[0];return ({es:'es',en:'en',pt:'pt-BR',tr:'tr'})[code]||null;
 }
 function setLanguage(value){
  if(!languages.some(x=>x[0]===value))return false;
  const scrolls=[document.scrollingElement,...document.querySelectorAll('.detail,.sprite-grid,.sequences,.viewer,.filters')].filter(Boolean).map(el=>[el,el.scrollLeft,el.scrollTop]);
  language=value;try{localStorage.setItem('sw-language',value);}catch{}
  refresh();for(const [el,x,y]of scrolls){el.scrollLeft=x;el.scrollTop=y;}
  window.dispatchEvent(new CustomEvent('sw-language-change',{detail:{language}}));return true;
 }
 function setupSelector(selector){
  const toggle=document.createElement('button');toggle.type='button';toggle.className='language-toggle';toggle.setAttribute('aria-haspopup','menu');toggle.setAttribute('aria-expanded','false');
  toggle.innerHTML='<img width="16" height="11" alt="" aria-hidden="true"><span class="language-code"></span>';
  const menu=document.createElement('div');menu.className='language-menu';menu.setAttribute('role','menu');menu.hidden=true;
  const close=(focus=false)=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus({preventScroll:true});};
  for(const [code,short,name,flag] of languages){
   const option=document.createElement('button');option.type='button';option.dataset.language=code;option.setAttribute('role','menuitemradio');option.tabIndex=-1;option.setAttribute('translate','no');
   const image=document.createElement('img');image.src='flags/'+flag+'.png';image.width=16;image.height=11;image.alt='';image.setAttribute('aria-hidden','true');
   const label=document.createElement('span');label.textContent=name+' '+short;option.append(image,label);
   option.addEventListener('click',()=>{setLanguage(code);close(true);});menu.append(option);
  }
  const options=[...menu.children];
  const open=()=>{for(const other of document.querySelectorAll('.language-menu'))other.hidden=true;for(const other of document.querySelectorAll('.language-toggle'))other.setAttribute('aria-expanded','false');menu.hidden=false;toggle.setAttribute('aria-expanded','true');options[languages.findIndex(x=>x[0]===language)].focus({preventScroll:true});};
  toggle.addEventListener('click',()=>menu.hidden?open():close());
  selector.addEventListener('keydown',event=>{
   if(event.key==='Escape'){if(!menu.hidden){event.preventDefault();event.stopPropagation();close(true);}return;}
   if(event.key==='Tab'){close();return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();event.stopPropagation();if(menu.hidden){open();return;}
    const index=options.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus({preventScroll:true});
   }
  });
  document.addEventListener('pointerdown',event=>{if(!selector.contains(event.target))close();});
  selector.addEventListener('focusout',event=>{if(!selector.contains(event.relatedTarget))close();});
  selector.append(toggle,menu);
 }
 function start(){
  let saved;try{saved=localStorage.getItem('sw-language');}catch{}
  language=languages.some(x=>x[0]===saved)?saved:(navigator.languages||[navigator.language]).map(normalizeLanguage).find(Boolean)||'es';
  if(window.SWSite?.authorized===true)for(const selector of document.querySelectorAll('.language-selector'))setupSelector(selector);
  observer=new MutationObserver(records=>{
   updating=true;observer.disconnect();
   for(const record of records){if(record.type==='attributes')update(record.target,record.attributeName);else if(record.type==='characterData')update(record.target);else for(const node of record.addedNodes)scan(node);}
   watch();updating=false;
  });refresh();
 }
 start();return {translate:resolve,setLanguage,get language(){return language;},languages,rows,refresh};
})();
