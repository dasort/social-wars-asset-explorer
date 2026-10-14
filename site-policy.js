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
// Extend this explicit list to authorize another owned deployment.
// Origins and project paths are checked once; no authorization requests are made.
window.SWSite=(()=>{
 const configuration=Object.freeze({
  officialURL:'https://dasort.github.io/social-wars-asset-explorer/',
  environments:Object.freeze([
   Object.freeze({origin:'https://dasort.github.io',path:'/social-wars-asset-explorer/'}),
  ]),
  localHosts:Object.freeze(['localhost','127.0.0.1','[::1]']),
 });
 function authorize(address){
  try{
   const url=new URL(address);
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false;
   if(configuration.localHosts.includes(url.hostname))return true;
   if(/%2f|%5c/i.test(url.pathname))return false;
   return configuration.environments.some(env=>url.origin===env.origin&&(url.pathname===env.path.slice(0,-1)||url.pathname.startsWith(env.path)));
  }catch{return false;}
 }
 const authorized=authorize(window.location.href);
 function showBlocked(){
  const site=document.querySelector?.('.site');if(site)site.hidden=true;
  const detail=document.getElementById?.('detail');if(detail)detail.hidden=true;
  const message=document.getElementById?.('site-authorization');if(message)message.hidden=false;
 }
 if(!authorized)showBlocked();else{const site=document.querySelector?.('.site');if(site)site.hidden=false;}
 return Object.freeze({authorized,configuration,authorize,showBlocked});
})();
