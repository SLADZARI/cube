// An isolated, FREE, loopback-only local pilot using the original Visual Canvas UI.
// NOT the published Sites v23. It cannot touch Sites D1/R2 or original local Studio.
// Run: node pilot/local-free-mvp.mjs
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir,rename,stat,readdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {tmpdir,homedir} from 'node:os';
import {resolve,dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert,validateGraph,revision,sha256,sniff} from './core.mjs';
import {receiveLocalOriginal,loadLocalReferenceOriginals,localGenerationPrompt} from './local-reference-support.mjs';

const sourceDir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const localObjectUX=readFileSync(new URL('./local-object-ui.js',import.meta.url),'utf8');
const localObjectJSON=readFileSync(new URL('./local-object-json.js',import.meta.url),'utf8');
const localObjectJSONUI=readFileSync(new URL('./local-object-json-ui.js',import.meta.url),'utf8');
const localObjectCompactCSS=readFileSync(new URL('./local-object-compact.css',import.meta.url),'utf8');
export const MODEL='x/flux2-klein:4b';
const MAX_REQUEST=1_800_000, MAX_OUTPUT=24*1024*1024;
const DEFAULT_DATA_DIR=resolve(homedir(),'Projects/studio-pilot-local-free-data');
const host='127.0.0.1';
const validAsset=id=>typeof id==='string'&&/^asset_[A-Za-z0-9_-]{1,128}$/.test(id);
const safeHeader={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};

function fail(code,status=422){const e=new Error(code);e.status=status;throw e;}
function writeJSON(res,value,status=200){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...safeHeader});
 res.end(JSON.stringify(value));
}
async function writeAtomic(file,text) {
 await mkdir(dirname(file),{recursive:true});
 const tmp=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(tmp,text,{flag:'wx'});await rename(tmp,file);}
 finally{await rm(tmp,{force:true}).catch(()=>{});}
}
async function bodyJSON(req){
 let size=0;const parts=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST)fail('REQUEST_TOO_LARGE',413);parts.push(chunk);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}
 catch{fail('INVALID_JSON',400);}
}
function aspectSize(ratio){
 return {'9:16':[576,1024],'3:4':[576,768],'1:1':[768,768],
 '4:3':[768,576],'16:9':[1024,576]}[ratio]||[576,1024];
}
function actualMime(bytes){
 const mime=sniff(bytes);
 if(!['image/png','image/jpeg','image/webp'].includes(mime)) fail('OUTPUT_NOT_IMAGE',502);
 return mime;
}
function modelPrompt(job){return localGenerationPrompt(job);}
function decodeImageBase64(content){
 if(typeof content!=='string'||content.length>Math.ceil(MAX_OUTPUT*4/3)+8||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content))fail('OUTPUT_BYTES_INVALID',502);
 const bytes=Buffer.from(content,'base64');
 if(bytes.length===0||bytes.length>MAX_OUTPUT)fail('OUTPUT_BYTES_INVALID',502);
 actualMime(bytes);
 return bytes;
}
// FLUX.2 Klein 4B is a step-distilled 4-step model. More than four steps
// waste energy/latency without being part of the model's intended settings.
export function localSamplingSteps(quality){
 return quality==='low'?2:quality==='medium'?3:4;
}
async function apiGenerate({prompt,ratio,quality,referenceOriginals=[]},baseUrl='http://127.0.0.1:11434'){
 const [width,height]=aspectSize(ratio);
 const steps=localSamplingSteps(quality);
 let response;
 try {response=await fetch(baseUrl+'/api/generate',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({model:MODEL,prompt,width,height,steps,stream:false,
    images:referenceOriginals.map(r=>Buffer.from(r.bytes).toString('base64'))}),
   signal:AbortSignal.timeout(420_000)
 });}catch{fail('OLLAMA_UNREACHABLE',503);}
 if(!response.ok){
   const body=(await response.text()).slice(0,1200);
   // Version-specific incompatibility is explicit, not a timeout or duplicate generation.
   if(response.status===400&&/image generation models are not currently supported/i.test(body))
     return {fallback:'CLI_UNSUPPORTED_API'};
   fail(response.status===404?'MODEL_NOT_INSTALLED':'OLLAMA_GENERATION_ERROR',502);
 }
 let content;
 try {content=await response.json();}catch{fail('OLLAMA_RESPONSE_INVALID',502);}
 const image=content?.image||content?.images?.[0];
 if(!image)fail('OLLAMA_NO_ORIGINAL',502);
 return {bytes:decodeImageBase64(image),engine:'ollama-api'};
}
function runCLI(args,{cwd,timeoutMs=420_000}={}){
 return new Promise((done,reject)=>{
  const cp=spawn('ollama',args,{cwd,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',finished=false;
  const timer=setTimeout(()=>cp.kill('SIGTERM'),timeoutMs);
  cp.stdout.on('data',b=>{if(stdout.length<30000)stdout+=b.toString('utf8').slice(0,30000-stdout.length)});
  cp.stderr.on('data',b=>{if(stderr.length<30000)stderr+=b.toString('utf8').slice(0,30000-stderr.length)});
  cp.on('error',e=>{if(!finished){finished=true;clearTimeout(timer);reject(e);}});
  cp.on('close',(code)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   code===0?done({stdout,stderr}):reject(new Error('OLLAMA_CLI_FAILED_'+code));
  });
 });
}
export async function generateWithLocalOllama({job,referenceOriginals=[]}){
 const prompt=modelPrompt(job);
 const ratio=job.payload?.ratio||'9:16', quality=job.payload?.quality||'high';
 const first=await apiGenerate({prompt,ratio,quality,referenceOriginals},process.env.STUDIO_OLLAMA_URL||'http://127.0.0.1:11434');
 if(first.bytes)return {bytes:first.bytes,engine:first.engine};
 if(first.fallback!=='CLI_UNSUPPORTED_API')fail('UNSUPPORTED_LOCAL_EXECUTOR',503);
 if(referenceOriginals.length)fail('REFERENCE_EDIT_API_UNAVAILABLE',503);
 // Ollama releases may temporarily remove API diffusion support while keeping
 // "ollama run" functional. Only fallback on the explicit unsupported API error.
 const temp=await mkdtemp(join(tmpdir(),'studio-flux2-'));
 try{
   await runCLI(['run',MODEL,prompt],{cwd:temp});
   const names=(await readdir(temp)).filter(x=>/\.png$|\.jpe?g$|\.webp$/i.test(x));
   if(names.length!==1)fail('OLLAMA_CLI_IMAGE_NOT_FOUND',502);
   const bytes=await readFile(join(temp,names[0]));
   actualMime(bytes);return {bytes,engine:'ollama-cli'};
 }finally{await rm(temp,{recursive:true,force:true}).catch(()=>{});}
}
export function createMinimalGraph(seed){
 const copy=structuredClone(seed);
 const prompt=copy.nodes.find(x=>x.type==='prompt');
 const generator=copy.nodes.find(x=>x.type==='generator');
 assert(prompt&&generator,'SEED_TWO_NODES_REQUIRED');
 const edge=copy.edges.find(e=>e.source===prompt.id&&e.target===generator.id&&
   generator.inputs.find(p=>p.id===e.targetPort)?.type==='TEXT');
 assert(edge,'SEED_TEXT_WIRE_REQUIRED');
 const graph={...copy,id:'proj_studio_local_free_mvp',title:'Studio · Local $0 MVP',
   nodes:[prompt,generator],edges:[edge],objects:[],objectGroups:[],
   globalObjectIds:[],inbox:[],groups:[]};
 prompt.text='A single bright red balloon floating in a pale blue sky. Soft sunlight, simple composition, no text.';
 prompt.images=[];generator.images=[];generator.jobs=[];generator.active=0;
 generator.objectId=null;generator.objectGroupId=null;generator.objectBindings=[];
 generator.objectGroupIds=[];generator.params={...generator.params,variant:'gpt',ratio:'9:16',runs:1};
 // Keep both original nodes and their TEXT wire visible on a laptop canvas.
 prompt.x=90;prompt.y=215;generator.x=600;generator.y=90;
 graph.camera={...graph.camera,x:210,y:85,z:0.55};
 validateGraph(graph);return graph;
}
const browserPatch="async function studioLocalRun(nodeId,jobId){\n const n=findN(nodeId),j=findJob(nodeId,jobId);\n if(!n||!j)return;\n if(window.STUDIO_LOCAL_BUSY){toast('Уже выполняется один Run');return;}\n window.STUDIO_LOCAL_BUSY=true;\n try {\n  if((j.payload.references||[]).length>4)throw Error('Максимум четыре референса на Run');\n  for(let attempt=0;activeUploads>0&&attempt<240;attempt++)await new Promise(done=>setTimeout(done,100));\n  if(activeUploads)throw Error('Дождитесь завершения загрузки оригинала изображения');\n  updateJobStatus(nodeId,jobId,'generating',true);\n  const saved=await saveGitSnapshot(false);\n  if(!saved)throw Error('Не удалось сохранить Job');\n  gitStatusText('Локальная генерация на Mac · $0');\n  const r=await fetch('/api/local-image/run',{\n   method:'POST',\n   headers:{'Content-Type':'application/json','X-Studio-Local':'1'},\n   body:JSON.stringify({nodeId,jobId})\n  });\n  const out=await r.json();\n  if(!r.ok||!out.ok)throw Error(out.error||'LOCAL_RUN_ERROR');\n  if(out.jobId!==jobId||out.nodeId!==nodeId||!out.readbackVerified||!out.imageUrl||\n     !out.project||!out.revision)throw Error('RESULT_READBACK_NOT_VERIFIED');\n  gitSuspend=true;\n  try{\n   data=out.project;gitRevision=out.revision;\n   lastSaved=JSON.stringify(compactProject());\n   pendingSave=false;conflicted=false;\n   render();persist();\n  }finally{gitSuspend=false;}\n  closeRunModal();\n  gitStatusText('Готово · локальная генерация $0 · '+out.engine);\n  toast('Картинка создана и показана в GPT Image ✓');\n }catch(e){\n  j.error=String(e?.message||'LOCAL_RUN_ERROR').slice(0,150);\n  updateJobStatus(nodeId,jobId,'blocked',true);\n  scheduleGitAutosave();\n  gitStatusText('Ошибка локальной генерации: '+e.message);\n  toast('Run: '+e.message);\n }finally{window.STUDIO_LOCAL_BUSY=false;}\n}\n\n// Only file uploads to this same-origin loopback server. Never send image bytes to\n// ChatGPT or remote services. Originals survive page reload; previews do not replace them.\nasync function studioLocalUploadOriginal(file,im){\n if(!file||!im?.id)return;\n activeUploads++;\n try {\n  if(file.size>12*1024*1024)throw Error('Лимит оригинала: 12 МБ');\n  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Поддерживаются PNG, JPEG и WebP');\n  const r=await fetch('/api/media/upload',{method:'POST',\n   headers:{'Content-Type':file.type,'X-Studio-Local':'1',\n    'X-CVC-Asset-ID':im.id,'X-CVC-File-Name':encodeURIComponent(file.name)},\n   body:file});\n  const result=await r.json();\n  if(!r.ok||!result.ok||!result.media?.readbackVerified)throw Error(result.error||'ORIGINAL_UPLOAD_UNVERIFIED');\n  const receipt=result.media;\n  const copies=[im,...mediaRegistry().filter(entry=>entry.id===im.id).map(entry=>entry.item)];\n  if(editingObjectDraft?.references)copies.push(...editingObjectDraft.references.filter(x=>x.id===im.id));\n  for(const item of new Set(copies)){\n   item.src=receipt.url;\n   item.transfer={provider:'local',status:'uploaded',sha256:receipt.sha256,\n    size:receipt.size,mimeType:receipt.mimeType,readbackVerified:true};\n  }\n  render();\n  if(editingObjectDraft)drawObjectReferences();\n  toast('Оригинал сохранён на Mac ✓');\n }catch(e){\n  im.transfer={status:'browser_pending',error:String(e?.message||'ORIGINAL_UPLOAD_FAILED')};\n  toast('Не удалось сохранить референс: '+im.transfer.error);\n }finally{\n  activeUploads--;\n  scheduleGitAutosave();\n }\n}\n\n// A single click on \"Attach reference\" produces an original Import Image node and\n// wires its IMAGE output to the correct generator IMAGE input. It never pushes\n// the reference image into generator resultIds or Inbox.\nconst localRefPicker=document.getElementById('localRefPicker');\nnodeLayer.addEventListener('click',e=>{\n const button=e.target.closest('[data-action=\"local-attach-ref\"]');\n if(!button)return;\n e.preventDefault();e.stopImmediatePropagation();\n const nEl=button.closest('.node'),n=nEl&&findN(nEl.dataset.node);\n if(!n||n.type!=='generator'||window.STUDIO_LOCAL_BUSY)return;\n localRefPicker.dataset.target=n.id;\n localRefPicker.value='';\n localRefPicker.click();\n},true);\nlocalRefPicker.onchange=async event=>{\n const targetId=localRefPicker.dataset.target;\n const target=findN(targetId),files=[...event.target.files].filter(f=>f.type.startsWith('image/'));\n localRefPicker.value='';\n if(!target||target.type!=='generator'||!files.length)return;\n const sourceCount=sources(target).filter(x=>x.p?.type==='IMAGE').length;\n const objectCount=resolveObjectsForNode(target).flatMap(o=>o.references||[]).length;\n if(files.length+sourceCount+objectCount>4)return toast('FLUX.2 Klein поддерживает максимум 4 изображения-референса');\n try{\n  for(const [i,file] of files.entries()){\n   if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Форматы: PNG, JPEG, WebP');\n   const imported=addNode('import',target.x-325,target.y+90+i*105,true);\n   await handleImages([file],imported.id);\n   if(!imported.images.length)throw Error('Изображение не удалось открыть');\n   const output=imported.outputs.find(p=>p.type==='IMAGE');\n   const input=target.inputs.find(p=>p.type==='IMAGE'&&!data.edges.some(e=>e.targetPort===p.id))||\n    addInput(target,true,'IMAGE');\n   if(!output||!input||!connect({n:imported,p:output},{n:target,p:input}))\n    throw Error('Не удалось связать референс с GPT Image');\n  }\n  render();scheduleGitAutosave();\n  toast('Референсы прикреплены · оригиналы сохраняются локально');\n }catch(e){toast('Референс: '+e.message);}\n};\n";

export function buildLocalHTML(html){
 const marker='async function sendJob(nodeId,jobId){';
 const originalRun='openRunModal(n,job);persist();drawNodes();if(selected.has(n.id))drawInspector();sendJob(n.id,job.id);';
 assert(html.includes(marker),'ORIGINAL_SEND_JOB_NOT_FOUND');
 assert(html.includes(originalRun),'ORIGINAL_RUN_FLOW_NOT_FOUND');
 const localStyle='<style id="studioLocalMinimal">' +
  // This is presentation-only. The original controls remain mounted so their
  // existing event handlers continue to initialize unmodified.
  '.rail .railitem[data-tab]:not([data-tab="tools"]):not([data-tab="inbox"]):not([data-tab="objects"]),.topactions,#selectionActions,#pilotExport,#pilotRecovery,#pilotBanner>a,#quickAdd,#saveTop,#chatStatus{display:none!important}' +
  '#toolList .tool:not([data-tool="prompt"]):not([data-tool="generator"]):not([data-tool="import"]):not([data-tool="object"]),#toolsPanel .searchline,#toolsPanel .side-notice{display:none!important}' +
  '.side{width:206px}.rail{width:48px}.tool-list{grid-template-columns:1fr 1fr;gap:8px}.tool{min-height:75px}' +
  '.topbar{right:15px}.viewport{min-width:0}.filename{font-weight:600}' +
  '.node-generator .image-preview img{image-rendering:auto}' +
  // Dense Object editor and Canvas card; fields, controls, types and references stay intact.
  '#objectModal .object-editor{width:min(720px,94vw);max-height:min(86vh,760px);padding:12px 14px;overflow:auto}' +
  '#objectModal .lightbox-head{margin-bottom:7px}' +
  '#objectModal .object-editor-basic{gap:8px;margin-bottom:7px}' +
  '#objectModal .object-editor input,#objectModal .object-editor select,#objectModal .object-editor textarea{padding:6px 8px;border-radius:7px;font-size:12px;line-height:1.25}' +
  '#objectModal .object-editor label{line-height:1.25}' +
  '#objectModal .object-editor-basic input,#objectModal .object-editor-basic select,#objectModal .object-label input,#objectModal .object-label textarea{margin-top:3px}' +
  '#objectModal .object-label{margin-bottom:7px}' +
  '#objectModal #objectDescription,#objectModal #objectCustom{min-height:46px}' +
  '#objectModal .object-ref-head{margin:3px 0 5px}#objectModal .object-ref-grid{margin:0 0 8px;min-height:0;gap:6px}' +
  '#objectModal .object-ref{width:94px}#objectModal .object-ref img{width:94px;height:70px}' +
  '#objectModal .object-ref-caption{padding:4px}#objectModal .object-ref button{padding:4px}' +
  '#objectModal .studio-local-characteristics{border:1px solid #484b50;border-radius:9px;padding:7px 9px;margin:4px 0 8px;background:#303238}' +
  '#objectModal .studio-local-characteristics>summary{cursor:pointer;font-weight:600;color:#d2e6dc;font-size:12px;padding:3px 0 6px}' +
  '#objectModal .studio-local-characteristics .object-field-group{background:transparent;border:0}' +
  '#objectModal .object-editor-fields{gap:8px;margin:6px 0 9px}#objectModal .object-field-group{gap:6px;padding:7px}' +
  '#objectModal .object-field-group label input,#objectModal .object-field-group label textarea{margin-top:3px}' +
  '#objectModal .object-editor-actions{position:sticky;bottom:-12px;background:#27292d;z-index:6;padding:8px 0 2px;margin-top:5px;gap:5px;border-top:1px solid #4b5056}' +
  '#objectModal .object-editor-actions button{padding:6px 9px}' +
  '#objectModal #objectAddRef{background:#36524a;color:#e1f6ec;border-color:#477363}' +
  '.node-object .object-canvas-card{cursor:pointer;min-height:104px;padding:8px;gap:5px;border-radius:8px}' +
  '.node-object .object-canvas-brow{font-size:9px}.node-object .object-canvas-name{font-size:13px;line-height:1.25}' +
  '.node-object .object-canvas-summary{font-size:10px;line-height:1.35}' +
  '.node-object .object-canvas-refs{max-height:54px}.node-object .object-canvas-refs img{width:52px;height:52px}' +
  '.node-object .object-canvas-card button{padding:5px 7px;font-size:10px}' +
  '@media(max-width:640px){#objectModal .object-editor{width:96vw;max-height:92dvh;padding:10px}#objectModal .object-editor-fields{grid-template-columns:1fr}#objectModal .object-editor-actions{flex-wrap:wrap}}' +
  '#pilotBanner{gap:16px;justify-content:flex-start}' +
  '@media(max-width:800px){.filename{padding:6px}.dock{left:50%;transform:translateX(-50%)}}' +
  localObjectCompactCSS +
  '</style>';
 let out=html
  .replace('async function uploadOriginal(file,im){',
   'async function uploadOriginal(file,im){if(window.STUDIO_LOCAL_MODE)return studioLocalUploadOriginal(file,im);')
  .replace('<input type="file" id="imagePicker"',
   '<input type="file" id="localRefPicker" accept="image/png,image/jpeg,image/webp" multiple hidden><input type="file" id="imagePicker"')
  .replace('<div class="generator-input-actions"><button class="var-add" data-action="add-input">',
   '<div class="generator-input-actions"><button class="var-add" data-action="local-attach-ref">📎 Референс</button><button class="var-add" data-action="add-input">')
  .replace(marker,browserPatch+'\n'+localObjectJSON+'\n'+localObjectUX+'\n'+localObjectJSONUI+'\n'+
    'async function sendJob(nodeId,jobId){if(window.STUDIO_LOCAL_MODE)return studioLocalRun(nodeId,jobId);')
  .replace('normalizeObjects();drawTools();bindObjectUI();render();',
    'normalizeObjects();drawTools();bindObjectUI();studioLocalObjectUiInit();studioLocalObjectJSONUIInit();render();')
  .replace('Выбрать объект / версию','Открыть / редактировать')
  .replace('Подключите объект из библиотеки','Нажми, чтобы создать героя или среду')
  .replace('Выберите объект','Создать героя или среду')
  .replace('id="objectRefPicker" accept="image/*"','id="objectRefPicker" accept="image/png,image/jpeg,image/webp"')
  .replace('function run(n){if(n.type',
    "function run(n){if(window.STUDIO_LOCAL_BUSY){toast('Один Run уже выполняется');return;}if(n.type")
  // Local Run must be a one-click action, with no manual clipboard modal.
  .replace(originalRun,
    "if(!window.STUDIO_LOCAL_MODE)openRunModal(n,job);persist();drawNodes();if(selected.has(n.id))drawInspector();sendJob(n.id,job.id);")
  .replace('<body>','<body><script>window.STUDIO_LOCAL_MODE=true;window.STUDIO_LOCAL_BUSY=false;</script>'+localStyle)
  .replace('<span id="pilotState">','<span class="studioLocalSteps">Prompt → GPT Image · 📎 Референсы · Объекты · Run · $0</span><span id="pilotState">')
  .replace('STUDIO PILOT','STUDIO LOCAL · $0')
  .replace('Генерация выполняется в ChatGPT вручную, в пределах его лимитов. Автоматическая передача референсов и результатов пока недоступна.',
    'Локальная генерация без оплаты: Prompt → GPT Image → Run. Изображение сохраняется на этом Mac.')
  .replace('Генерация — контролируемый чат-handoff; автоматическое выполнение не подключено.',
    'FLUX.2 Klein: текст, объекты и до 4 настоящих PNG/JPEG/WebP-референсов. Оригиналы хранятся на Mac.')
  .replaceAll('loading="lazy"','loading="eager"')
  .replaceAll('Studio Pilot · D1/R2','Studio Local · Mac')
  .replaceAll('Генерация в ChatGPT','Генерация на Mac · $0')
  .replaceAll('GPT Image (ChatGPT)','FLUX.2 Klein · Mac ($0)')
  .replaceAll('Это настройки задания. Формат и фон передаются в промпт; поддержка точных параметров зависит от ChatGPT. Flare не является доступной моделью ChatGPT.',
    'FLUX.2 Klein работает локально. Соотношение сторон и качество применяются. Результат сохраняется как PNG, независимо от желаемого формата; прозрачность не гарантируется.')
  .replaceAll('R2: оригиналы PNG/JPEG/WebP/GLB до 24 MiB. Новые asset ID; существующие оригиналы не перезаписываются.',
    'Все оригиналы сохраняются локально на этом Mac. Внешние API и R2 не используются.');
 out=out.replaceAll('GPT Image','AI Image');
 assert(out!==html,'LOCAL_UI_PATCH_MISSING');
 return out;
}
export async function createLocalMvpServer({directory=DEFAULT_DATA_DIR,engine=generateWithLocalOllama}={}){
 const localDir=resolve(directory);
 await mkdir(localDir,{recursive:true});
 const source=JSON.parse((await readFile(join(sourceDir,'lib/canvas-html.ts'),'utf8'))
  .replace(/^export const canvasHTML=/,'').replace(/;\s*$/,''));
 const html=buildLocalHTML(source);
 const projectFile=join(localDir,'project.json');
 const seed=JSON.parse(await readFile(join(sourceDir,'pilot/seed.json'),'utf8'));
 let store;
 try{store=JSON.parse(await readFile(projectFile,'utf8'));}
 catch(e){if(e.code!=='ENOENT')throw e;
   const graph=createMinimalGraph(seed);
   store={project:graph,revision:await revision(graph),updatedAt:Date.now()};
   await writeAtomic(projectFile,JSON.stringify(store));}
 validateGraph(store.project,'proj_studio_local_free_mvp');
 const files=new Map();
 let inFlight=null;
 const mediaDir=join(localDir,'media');
 await mkdir(mediaDir,{recursive:true});
 const allowedHost=h=>/^127\.0\.0\.1:\d{1,5}$/.test(h||'')||/^localhost:\d{1,5}$/.test(h||'');
 const server=createServer(async(req,res)=>{
  try{
   const requestedHost=req.headers.host||'';
   if(!allowedHost(requestedHost))fail('LOCAL_ONLY',403);
   const u=new URL(req.url,'http://'+requestedHost);
   if(req.method==='POST'){
    if(req.headers['x-studio-local']!=='1'&&req.headers['x-studio-pilot']!=='1')fail('LOCAL_CSRF',403);
    if(req.headers.origin!=='http://'+requestedHost)fail('LOCAL_ORIGIN',403);
   }
   if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/canvas')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...safeHeader});res.end(html);return;
   }
   if(req.method==='GET'&&u.pathname==='/api/project'){writeJSON(res,store);return;}
   if(req.method==='GET'&&u.pathname==='/api/status'){
    writeJSON(res,{revision:store.revision,storage:'LOCAL_ONLY',model:MODEL,price:'$0'});return;
   }
   if(req.method==='GET'&&u.pathname==='/api/media/status'){
    writeJSON(res,{media:{mode:'local',configured:true,note:'Model and images on your Mac, no external API'}});return;
   }
   if(req.method==='POST'&&u.pathname==='/api/media/upload'){
    if(inFlight)fail('UPLOAD_DURING_GENERATION',409);
    const receipt=await receiveLocalOriginal(req,mediaDir);
    writeJSON(res,{ok:true,media:receipt});return;
   }
   if(req.method==='POST'&&u.pathname==='/api/save'){
    const b=await bodyJSON(req);
    if(b.expectedRevision!==store.revision)fail('REVISION_CONFLICT',409);
    validateGraph(b.project,store.project.id);
    const newRev=await revision(b.project);
    if(newRev===await revision(store.project)){writeJSON(res,{ok:true,unchanged:true,revision:store.revision});return;}
    store={project:b.project,revision:await sha256(new TextEncoder().encode(newRev+'\n'+store.revision)),updatedAt:Date.now()};
    await writeAtomic(projectFile,JSON.stringify(store));
    writeJSON(res,{ok:true,readbackVerified:true,revision:store.revision});return;
   }
   if(req.method==='POST'&&u.pathname==='/api/local-image/run'){
    const b=await bodyJSON(req), {nodeId,jobId}=b;
    if(!/^n_[A-Za-z0-9_-]+$/.test(nodeId||'')||!/^job_[A-Za-z0-9_-]+$/.test(jobId||''))fail('INVALID_JOB_ID');
    const existingReceipt=files.get(jobId);
    if(existingReceipt){writeJSON(res,existingReceipt);return;}
    if(inFlight)fail('ANOTHER_RUN_ACTIVE',409);
    const node=store.project.nodes.find(x=>x.id===nodeId&&x.type==='generator');
    const job=node?.jobs?.find(x=>x.id===jobId);
    if(!job||!['prepared','generating'].includes(job.status)||job.resultIds?.length)fail('JOB_NOT_PREPARED',409);
    const link=store.project.edges.find(e=>e.target===nodeId&&
       node.inputs.find(p=>p.id===e.targetPort)?.type==='TEXT');
    const prompt=store.project.nodes.find(n=>n.id===link?.source);
    if(prompt?.type!=='prompt'||!prompt.text?.trim()||job.payload?.prompt!==prompt.text)
      fail('PROMPT_WIRE_MISMATCH');
    if(job.payload?.runs!==1)fail('LOCAL_ONE_RUN_ONLY');
    inFlight=jobId;
    try{
      const referenceOriginals=await loadLocalReferenceOriginals(job,store.project,mediaDir);
      const generated=await engine({job,model:MODEL,referenceOriginals});
      const bytes=generated?.bytes;
      if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_OUTPUT)fail('MODEL_OUTPUT_MISSING',502);
      const mimeType=actualMime(bytes),digest=await sha256(bytes);
      const assetId='asset_local_'+digest.slice(0,28);
      const extension=mimeType==='image/png'?'.png':mimeType==='image/jpeg'?'.jpg':'.webp';
      const imagePath=join(mediaDir,assetId+extension);
      await writeFile(imagePath,bytes,{flag:'wx'}).catch(async e=>{
       if(e.code!=='EEXIST')throw e;
       if(await sha256(await readFile(imagePath))!==digest)fail('ORIGINAL_HASH_MISMATCH',409);
      });
      const saved=await readFile(imagePath);
      if(saved.length!==bytes.length||await sha256(saved)!==digest)fail('ORIGINAL_READBACK_FAILED',503);
      const image={id:assetId,name:'Local FLUX.2 image '+jobId,
        src:'/api/media/'+assetId,createdAt:Date.now(),
        transfer:{provider:'local',status:'uploaded',sha256:digest,size:bytes.length,mimeType,readbackVerified:true}};
      node.images.push(image);node.active=node.images.length-1;
      job.referenceReceipts=referenceOriginals.map(({bytes,...receipt})=>receipt);
      job.resultIds=[assetId];job.status='result_imported';
      const inboxId='inbox_'+randomUUID().replace(/-/g,'');
      store.project.inbox.push({id:inboxId,nodeId,jobId,imageId:assetId,name:image.name,createdAt:Date.now()});
      validateGraph(store.project,store.project.id);
      store={...store,revision:await revision(store.project),updatedAt:Date.now()};
      await writeAtomic(projectFile,JSON.stringify(store));
      const check=JSON.parse(await readFile(projectFile,'utf8'));
      if(!check.project.nodes.find(n=>n.id===nodeId)?.jobs?.find(j=>j.id===jobId)?.resultIds?.includes(assetId)||
        !check.project.inbox.some(x=>x.jobId===jobId&&x.imageId===assetId))fail('SAME_JOB_VERIFY_FAILED',503);
      const receipt={ok:true,jobId,nodeId,assetId,imageUrl:image.src,revision:store.revision,
        project:store.project,sha256:digest,size:bytes.length,mimeType,
        readbackVerified:true,resultImported:true,engine:generated.engine||'local-test'};
      files.set(jobId,receipt);writeJSON(res,receipt);return;
    }finally{inFlight=null;}
   }
   if(req.method==='GET'&&u.pathname.startsWith('/api/media/asset_')){
    const assetId=basename(u.pathname);if(!validAsset(assetId))fail('MEDIA_ID_INVALID',400);
    const entries=(await readdir(mediaDir)).filter(n=>n.startsWith(assetId+'.'));
    if(entries.length!==1)fail('MEDIA_NOT_FOUND',404);
    const bytes=await readFile(join(mediaDir,entries[0]));
    const mime=actualMime(bytes);
    res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length,'X-Studio-SHA256':await sha256(bytes),...safeHeader});
    res.end(bytes);return;
   }
   if(req.method==='GET'&&u.pathname==='/api/export'){
    writeJSON(res,{format:'studio-local-mvp/1',...store,source:'local-only',canonicalSwitched:false});return;
   }
   writeJSON(res,{ok:false,error:'NOT_FOUND'},404);
  }catch(e){
   const code=e?.status?e.message:'LOCAL_INTERNAL_ERROR';
   // Log only error code and local path; never log prompts or image bytes.
   console.warn('STUDIO_LOCAL_API_ERROR',req.method,String(req.url).split('?')[0],code);
   writeJSON(res,{ok:false,error:code},e?.status||500);
  }
 });
 return {server,getStore:()=>store,directory:localDir};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {server,directory}=await createLocalMvpServer();
 const port=Number(process.env.STUDIO_LOCAL_PORT||18789);
 server.listen(port,host,()=>{
  process.stdout.write('STUDIO_LOCAL_MVP_READY http://127.0.0.1:'+port+'/canvas\n');
  process.stdout.write('DATA_DIR='+directory+'\nMODEL='+MODEL+'\nCOST=0\n');
 });
}