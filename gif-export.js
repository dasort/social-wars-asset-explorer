/* Browser-only GIF89a export. One frame at a time; no external service. */
const gifScope=typeof window==='undefined'?self:window;
gifScope.SWGIF=(()=>{
  const workerURL=typeof document!=='undefined'?document.currentScript?.src:null;
  function palette(rgba){
    const bins=new Map();
    for(let i=0;i<rgba.length;i+=4){if(rgba[i+3]<128)continue;const key=(rgba[i]>>3)*1024+(rgba[i+1]>>3)*32+(rgba[i+2]>>3);let b=bins.get(key);if(!b){b={key,n:0,r:0,g:0,b:0};bins.set(key,b);}b.n++;b.r+=rgba[i];b.g+=rgba[i+1];b.b+=rgba[i+2];}
    const boxes=[Array.from(bins.values())];
    const range=box=>{const lo=[255,255,255],hi=[0,0,0];let n=0;for(const b of box){n+=b.n;[b.r/b.n,b.g/b.n,b.b/b.n].forEach((v,k)=>{lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);});}const spans=hi.map((v,k)=>v-lo[k]),axis=spans.indexOf(Math.max(...spans));return {axis,score:spans[axis]*Math.sqrt(n)};};
    while(boxes.length<255){let pick=-1,best=-1,axis=0;boxes.forEach((b,i)=>{if(b.length<2)return;const r=range(b);if(r.score>best){best=r.score;pick=i;axis=r.axis;}});if(pick<0)break;const box=boxes[pick],channel=['r','g','b'][axis];box.sort((a,b)=>a[channel]/a.n-b[channel]/b.n);const half=box.reduce((s,b)=>s+b.n,0)/2;let sum=0,cut=1;for(;cut<box.length;cut++){sum+=box[cut-1].n;if(sum>=half)break;}cut=Math.min(cut,box.length-1);boxes.splice(pick,1,box.slice(0,cut),box.slice(cut));}
    const table=new Uint8Array(768),mapping=new Map();boxes.forEach((box,j)=>{if(!box.length)return;const n=box.reduce((s,b)=>s+b.n,0);['r','g','b'].forEach((c,k)=>table[(j+1)*3+k]=Math.round(box.reduce((s,b)=>s+b[c],0)/n));box.forEach(b=>mapping.set(b.key,j+1));});
    const pixels=new Uint8Array(rgba.length/4);for(let i=0;i<pixels.length;i++){const p=i*4;if(rgba[p+3]>=128)pixels[i]=mapping.get((rgba[p]>>3)*1024+(rgba[p+1]>>3)*32+(rgba[p+2]>>3));}return {table,pixels};
  }
  function lzw(pixels){
    const output=[];let buffer=0,count=0,bits=9,next=258,dict=new Map();
    const emit=code=>{buffer|=code<<count;count+=bits;while(count>=8){output.push(buffer&255);buffer>>>=8;count-=8;}};
    emit(256);let prefix=pixels[0];
    for(let i=1;i<pixels.length;i++){const c=pixels[i],key=prefix*256+c,found=dict.get(key);if(found!==undefined){prefix=found;continue;}emit(prefix);if(next<4096){dict.set(key,next++);if(next>(1<<bits)&&bits<12)bits++;}else{emit(256);dict=new Map();next=258;bits=9;}prefix=c;}
    emit(prefix);emit(257);if(count)output.push(buffer&255);return new Uint8Array(output);
  }
  class Encoder{
    constructor(width,height,fps){this.width=width;this.height=height;this.fps=fps;this.index=0;this.parts=[];this.write([...new TextEncoder().encode('GIF89a'),width&255,width>>8,height&255,height>>8,0,0,0,0x21,0xff,11,...new TextEncoder().encode('NETSCAPE2.0'),3,1,0,0,0]);}
    write(bytes){this.parts.push(new Uint8Array(bytes));}
    add(rgba){if(rgba.length!==this.width*this.height*4)throw Error('Dimensiones GIF incompatibles');const {table,pixels}=palette(rgba),delay=Math.max(2,Math.round((this.index+1)*100/this.fps)-Math.round(this.index*100/this.fps));this.index++;this.write([0x21,0xf9,4,9,delay&255,delay>>8,0,0,0x2c,0,0,0,0,this.width&255,this.width>>8,this.height&255,this.height>>8,0x87]);this.parts.push(table);this.write([8]);const data=lzw(pixels);for(let i=0;i<data.length;i+=255){this.write([Math.min(255,data.length-i)]);this.parts.push(data.slice(i,i+255));}this.write([0]);}
    finish(){if(!this.index)throw Error('GIF sin frames');return new Blob([...this.parts,new Uint8Array([0x3b])],{type:'image/gif'});}
  }
  async function exportSequence(frames,group,fps,onProgress){
    if(!frames.length)throw Error('No hay frames para GIF');
    const canvas=document.createElement('canvas');canvas.width=220;canvas.height=220;const ctx=canvas.getContext('2d',{willReadFrequently:true});let worker=null;
    if(workerURL&&typeof Worker!=='undefined'){try{worker=new Worker(workerURL);}catch{}}
    const send=(message,transfer=[])=>new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);worker.onerror=()=>reject(Error('No se pudo generar el GIF'));worker.postMessage(message,transfer);});
    const encoder=worker?null:new Encoder(220,220,fps);
    try{
      if(worker)await send({type:'init',fps});
      for(let i=0;i<frames.length;i++){onProgress(i,frames.length,'Cargando');const im=await SWMedia.image(frames[i],{priority:1});SWMedia.paint(canvas,im,frames[i],group);const rgba=ctx.getImageData(0,0,220,220).data;if(worker)await send({type:'frame',rgba},[rgba.buffer]);else encoder.add(rgba);onProgress(i+1,frames.length,'Preparando');await new Promise(resolve=>setTimeout(resolve,0));}
      return worker?(await send({type:'finish'})).blob:encoder.finish();
    }finally{worker?.terminate();}
  }
  return {Encoder,exportSequence};
})();
if(typeof window==='undefined'){
  let encoder=null;self.onmessage=e=>{try{const d=e.data;if(d.type==='init')encoder=new self.SWGIF.Encoder(220,220,d.fps);else if(d.type==='frame')encoder.add(d.rgba);else if(d.type==='finish'){self.postMessage({blob:encoder.finish()});encoder=null;return;}self.postMessage({ok:true});}catch(error){self.postMessage({error:error.message});}};
}
