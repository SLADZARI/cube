// Isolated $0 Studio: original reference bytes and object descriptions.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256,sniff} from './core.mjs';

export const MAX_REFERENCE_COUNT=4;
export const MAX_REFERENCE_FILE_BYTES=12*1024*1024;
export const MAX_REFERENCE_TOTAL_BYTES=24*1024*1024;
const MIMES={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
const idOk=id=>typeof id==='string'&&/^asset_[A-Za-z0-9_-]{1,120}$/.test(id);
function reject(code,status=422){throw Object.assign(new Error(code),{status,code});}
function mimeOf(bytes){let mime;try{mime=sniff(bytes)}catch{reject('REFERENCE_UNSUPPORTED_IMAGE',415);}if(!MIMES[mime])reject('REFERENCE_UNSUPPORTED_IMAGE',415);return mime;}

export async function receiveLocalOriginal(req,mediaDir){
 const id=req.headers['x-cvc-asset-id'];
 if(!idOk(id))reject('INVALID_REFERENCE_ASSET_ID',400);
 let n=0;const pieces=[];
 for await(const chunk of req){
  n+=chunk.length;
  if(n>MAX_REFERENCE_FILE_BYTES)reject('REFERENCE_FILE_TOO_LARGE',413);
  pieces.push(chunk);
 }
 const bytes=Buffer.concat(pieces);
 if(!bytes.length)reject('REFERENCE_EMPTY_FILE',400);
 const mime=mimeOf(bytes);
 const claimedType=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
 if(claimedType&&claimedType!==mime)reject('REFERENCE_MIME_MISMATCH',415);
 const digest=await sha256(bytes);
 await mkdir(mediaDir,{recursive:true});
 const names=(await readdir(mediaDir)).filter(x=>x.startsWith(id+'.'));
 if(names.length>1)reject('REFERENCE_ASSET_COLLISION',409);
 const file=join(mediaDir,id+MIMES[mime]);
 if(names.length===1&&names[0]!==id+MIMES[mime])reject('REFERENCE_ASSET_COLLISION',409);
 if(!names.length){
  try{await writeFile(file,bytes,{flag:'wx'});}catch(e){
   if(e.code!=='EEXIST')throw e;
  }
 }
 const reread=await readFile(file);
 if(reread.length!==bytes.length||await sha256(reread)!==digest)reject('REFERENCE_ASSET_COLLISION',409);
 return {id,url:'/api/media/'+id,relativePath:'media/'+id+MIMES[mime],
  sha256:digest,size:bytes.length,mimeType:mime,readbackVerified:true,provider:'local'};
}
function allRegisteredImages(graph){
 const map=new Map();
 for(const n of graph.nodes||[])for(const im of n.images||[])map.set(im.id,im);
 for(const obj of graph.objects||[]){
  for(const im of obj.references||[])map.set(im.id,im);
  for(const rev of obj.revisions||[])for(const im of rev.snapshot?.references||[])
   if(!map.has(im.id))map.set(im.id,im);
 }
 return map;
}
export async function loadLocalReferenceOriginals(job,graph,mediaDir){
 const refs=job?.payload?.references||[];
 if(!Array.isArray(refs))reject('INVALID_REFERENCE_LIST',422);
 if(refs.length>MAX_REFERENCE_COUNT)reject('REFERENCE_LIMIT_FOUR',422);
 const registered=allRegisteredImages(graph),results=[];
 let total=0;
 for(const [i,ref] of refs.entries()){
  const id=ref?.imageId;
  if(!idOk(id)||ref.available===false)reject('REFERENCE_NOT_READY',422);
  const im=registered.get(id);
  if(!im||im.src!=='/api/media/'+id)reject('REFERENCE_NOT_REGISTERED',422);
  if(im.transfer?.provider!=='local'||im.transfer?.readbackVerified!==true ||
     !/^[a-f0-9]{64}$/.test(im.transfer?.sha256||''))reject('REFERENCE_ORIGINAL_REQUIRED',422);
  const files=(await readdir(mediaDir)).filter(name=>name.startsWith(id+'.'));
  if(files.length!==1)reject('REFERENCE_ORIGINAL_MISSING',422);
  const bytes=await readFile(join(mediaDir,files[0]));
  total+=bytes.length;
  if(!bytes.length||bytes.length>MAX_REFERENCE_FILE_BYTES||total>MAX_REFERENCE_TOTAL_BYTES)
   reject('REFERENCE_MEMORY_LIMIT',413);
  const mime=mimeOf(bytes),digest=await sha256(bytes);
  if(im.transfer.sha256!==digest||im.transfer.size!==bytes.length||
     im.transfer.mimeType!==mime)reject('REFERENCE_INTEGRITY_MISMATCH',422);
  if(ref.objectId&&!graph.objects?.some(o=>o.id===ref.objectId))
   reject('REFERENCE_OBJECT_REMOVED',422);
  results.push({imageId:id,bytes,mimeType:mime,size:bytes.length,
    sha256:digest,slot:ref.slot||'Image '+(i+1),source:ref.source||im.name||id});
 }
 return results;
}
export function localGenerationPrompt(job){
 const p=job?.payload||{},instruction=String(p.prompt||'').trim();
 if(!instruction||instruction.length>7000)reject('MVP_PROMPT_REQUIRED');
 if(p.runs!==undefined&&Number(p.runs)!==1)reject('MVP_ONE_RUN_ONLY');
 const objects=Array.isArray(p.objects)?p.objects:[];
 if(objects.length>16)reject('TOO_MANY_OBJECTS',422);
 const descriptions=objects.map(o=>{
  if(!o||typeof o.name!=='string'||!o.name.trim())reject('INVALID_OBJECT_DESCRIPTION');
  const fields=Object.entries({...o.params,...o.custom}).filter(([k,v])=>
   /^[A-Za-z0-9_]+$/.test(k)&&v!==null&&v!==undefined&&String(v).trim())
   .slice(0,18).map(([k,v])=>k+': '+String(v).slice(0,180));
  return 'Object '+o.name+' (v'+(o.version||1)+'): '+String(o.description||'').slice(0,1500)+'\n'+fields.join('; ');
 });
 const references=Array.isArray(p.references)?p.references:[];
 if(references.length>MAX_REFERENCE_COUNT)reject('REFERENCE_LIMIT_FOUR');
 const ratio=p.ratio||'9:16';
 const bg=p.background==='opaque'?'opaque solid background':p.background==='transparent'?
  'simple isolated background (true alpha channel not guaranteed)':'natural background';
 let prompt=instruction+'\n\nCompose as '+ratio+' aspect ratio, '+bg+'. One still image. No watermark.';
 if(descriptions.length)prompt+='\n\nPreserve these named objects and their defining visual attributes:\n'+descriptions.join('\n');
 if(references.length)prompt+='\n\nIMPORTANT: '+references.length+
  ' actual reference image(s) are attached as image inputs, in this exact order. '+
  'Use them for subject identity, appearance and visual consistency as described. '+
  references.map((r,i)=>'Image '+(i+1)+': '+String(r.source||r.slot||'Reference').slice(0,100)).join('; ');
 return prompt;
}
