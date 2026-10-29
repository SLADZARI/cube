// Compact object editor & JSON controls inside the original Canvas closure.
// Uses the existing object form, field renderer, upload flow and save/versioning.
function studioLocalObjectJSONUIInit(){
 if(!window.STUDIO_LOCAL_MODE)return;
 const api=window.StudioLocalObjectJSON;
 if(!api)throw Error('OBJECT_JSON_HELPER_MISSING');
 const form=$('objectForm'),kindSelect=$('objectKind');
 const title=$('objectModalTitle');
 if(!form||!kindSelect||!title)throw Error('OBJECT_FORM_MISSING');
 const description=$('objectDescription');
 const detail=document.getElementById('studioLocalObjectAttributes');
 const refHead=form.querySelector('.object-ref-head');
 const refs=$('objectReferences');
 const custom=$('objectCustom');
 if(!detail||!refHead||!refs||!description||!custom)throw Error('OBJECT_LAYOUT_MISSING');

 // Place description and thumbnails side-by-side; keep all original elements and listeners.
 const overview=document.createElement('div');
 overview.id='studioLocalObjectOverview';
 const imagePanel=document.createElement('div');
 imagePanel.className='studio-local-image-panel';
 const descLabel=description.closest('label');
 form.insertBefore(overview,detail);
 overview.appendChild(descLabel);
 overview.appendChild(imagePanel);
 imagePanel.appendChild(refHead);
 imagePanel.appendChild(refs);
 detail.appendChild(custom.closest('label'));
 description.rows=3;
 custom.rows=2;

 const jsonBar=document.createElement('div');
 jsonBar.className='studio-local-json-bar';
 jsonBar.id='studioLocalJSONBar';
 jsonBar.innerHTML='<span class="studio-local-json-label">JSON</span>'+
  '<button type="button" id="studioLocalJSONTemplate" title="Пустой шаблон выбранного типа">↓ Шаблон</button>'+
  '<button type="button" id="studioLocalJSONExport" title="Текущие текстовые поля">↓ Текущий</button>'+
  '<button type="button" id="studioLocalJSONImport" title="Заполнить поля из JSON">↑ Загрузить</button>'+
  '<input type="file" id="studioLocalJSONFile" accept=".json,application/json" hidden>'+
  '<span id="studioLocalJSONStatus" role="status" aria-live="polite">JSON переносит описания, не фото</span>';
 form.insertBefore(jsonBar,form.firstChild);
 const picker=$('studioLocalJSONFile'),status=$('studioLocalJSONStatus');
 function message(value,error=false){
  status.textContent=value;
  status.dataset.error=error?'1':'0';
 }
 function formText(){
  const params=Object.create(null);
  $('objectFields').querySelectorAll('[data-param]').forEach(el=>params[el.dataset.param]=el.value);
  return {kind:kindSelect.value,name:$('objectName').value,
   description:description.value,params,custom:parseCustomLines(custom.value)};
 }
 function fileName(type,prefix,name){
  const part=(name||'object').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu,'-')
   .replace(/^-+|-+$/g,'').slice(0,48)||'object';
  return 'studio-'+type+'-'+prefix+'-'+part+'.json';
 }
 function download(payload,prefix){
  const encoded=JSON.stringify(payload,null,2)+'\n';
  const blob=new Blob([encoded],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=fileName(payload.type,prefix,payload.name);
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
  message('Файл '+a.download+' сохранён');
 }
 $('studioLocalJSONTemplate').onclick=()=>{
  try{download(api.template(kindSelect.value),'template');}
  catch(e){message(e.message,true);}
 };
 $('studioLocalJSONExport').onclick=()=>{
  try{const current=formText();download(api.template(current.kind,current),'current');}
  catch(e){message(e.message,true);}
 };
 $('studioLocalJSONImport').onclick=()=>{picker.value='';picker.click();};
 picker.onchange=async()=>{
  const file=picker.files?.[0];
  picker.value='';
  if(!file)return;
  try{
   if(file.size>128*1024)throw Error('JSON слишком большой (лимит 128 КБ)');
   if(!/\.json$/i.test(file.name))throw Error('Выберите файл с расширением .json');
   // UTF-8 BOM is common in JSON edited on Windows; strip it before parsing.
   const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
   const current=formText();
   const isSaved=!!getObject(editingObjectDraft?.id);
   // Validate all content before applying anything; never modify an existing Object ID,
   // references, version number, graph binding, or underlying image bytes.
   const imported=api.normalize(raw,{current,lockedKind:isSaved});
   if(isSaved&&JSON.stringify(current)!==JSON.stringify(imported)&&
      !confirm('Заполнить текстовые поля из JSON? Прикреплённые изображения и версии останутся без изменений.')){
    message('Импорт отменён');return;
   }
   if(imported.kind!==kindSelect.value){
    kindSelect.value=imported.kind;
    kindSelect.dispatchEvent(new Event('change',{bubbles:true}));
   }
   if(!editingObjectDraft)throw Error('Откройте объект перед импортом');
   // Only typed textual properties are changed; photos remain attached.
   editingObjectDraft.kind=imported.kind;
   editingObjectDraft.name=imported.name;
   editingObjectDraft.description=imported.description;
   editingObjectDraft.params=imported.params;
   editingObjectDraft.custom=imported.custom;
   $('objectName').value=imported.name;
   description.value=imported.description;
   drawObjectFields();
   $('objectFields').querySelectorAll('[data-param]').forEach(el=>{
    el.value=String(imported.params[el.dataset.param]??'');
   });
   custom.value=Object.entries(imported.custom).map(([k,v])=>k+': '+v).join('\n');
   message('JSON загружен. Проверьте поля и нажмите «Сохранить объект».');
   toast('Поля заполнены из JSON ✓');
  }catch(err){
   message('Ошибка JSON: '+String(err?.message||err),true);
  }
 };
 window.STUDIO_LOCAL_OBJECT_JSON={template:api.template,normalize:api.normalize};
}
