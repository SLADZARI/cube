// Studio LOCAL extension: make Object a working editable Hero/Environment.
// This code executes INSIDE the original Canvas closure after its declarations.
// Original compilePrompt, graph schema, image bridge and generator are unchanged.
let studioLocalEditingObjectNode = null;

function studioLocalObjectUiInit(){
 if(!window.STUDIO_LOCAL_MODE)return;
 const types=window.CVCObjectTypes?.types;
 if(!types?.character||!types?.environment)throw Error('LOCAL_OBJECT_TYPES_NOT_FOUND');
 types.character.label='Герой';
 types.environment.label='Среда';

 const allowedKinds=new Set(['character','environment']);
 for(const obj of data.objects||[])allowedKinds.add(obj.kind);
 for(const name of ['objectKind','objectKindFilter']){
  const select=$(name);
  if(!select)continue;
  for(const option of [...select.options]){
   if(option.value&&!allowedKinds.has(option.value))option.remove();
   if(option.value==='character')option.textContent='Герой';
   if(option.value==='environment')option.textContent='Среда';
  }
 }
 // Put essential fields BEFORE the long structured details, so editing
 // the description or a reference never requires scrolling past 9 inputs.
 const form=$('objectForm'),nameField=$('objectName'),kindField=$('objectKind');
 const description=$('objectDescription'),fields=$('objectFields');
 const refHead=form.querySelector('.object-ref-head');
 const refList=$('objectReferences');
 if(!form||!fields||!refHead||!refList)throw Error('LOCAL_OBJECT_FORM_NOT_FOUND');
 const basic=form.querySelector('.object-editor-basic');
 basic.insertBefore(kindField.parentElement,nameField.parentElement);
 const typeLabel=kindField.parentElement.firstChild;
 if(typeLabel?.nodeType===3)typeLabel.textContent='Тип объекта';
 const detailWrap=document.createElement('details');
 detailWrap.className='studio-local-characteristics';
 detailWrap.id='studioLocalObjectAttributes';
 detailWrap.open=true;
 const detailTitle=document.createElement('summary');
 detailTitle.id='studioLocalAttributeTitle';
 detailTitle.textContent='Характеристики героя';
 detailWrap.append(detailTitle,fields);
 form.insertBefore(refHead,form.querySelector('.object-editor-actions'));
 form.insertBefore(refList,form.querySelector('.object-editor-actions'));
 // Reposition the references immediately after Description.
 const afterDescription=description.parentElement.nextSibling;
 form.insertBefore(refHead,afterDescription);
 form.insertBefore(refList,afterDescription);
 form.insertBefore(detailWrap,form.querySelector('#objectCustom')?.closest('.object-label')||form.querySelector('.object-editor-actions'));
 description.rows=3;
 refHead.querySelector('b').textContent='Изображения и референсы';
 $('objectAddRef').textContent='＋ Добавить изображение';
 $('objectRefPicker').accept='image/png,image/jpeg,image/webp';
 // Stored node titles may originate in the previous local build. Rename the
 // display labels without changing generator type, node IDs or Job references.
 // The transport adapter assigns its initial lastSaved snapshot AFTER this
 // original Canvas initialization. Defer the title change itself, not merely
 // the save. Otherwise the migration silently looks unchanged to the server.
 setTimeout(()=>{
  let renamed=false;
  for(const n of data.nodes||[]){
   const legacyName='GPT'+' Image';
   if(n.type==='generator'&&typeof n.title==='string'&&n.title.includes(legacyName)){
    n.title=n.title.replaceAll(legacyName,'AI Image');
    renamed=true;
   }
  }
  if(renamed){render();persist();}
 },0);

 const savedOriginalOpen=openObjectEditor;
 const savedOriginalClose=closeObjectEditor;
 const savedOriginalSave=saveObjectDraft;
 const savedOriginalAddNode=addNode;
 function syncModal(){
  const select=$('objectKind');
  const kind=select.value;
  const isEnvironment=kind==='environment';
  const existing=!!getObject(editingObjectDraft?.id);
  $('objectModalTitle').textContent=(existing?'Изменить ':'Создать ')+(isEnvironment?'среду':'героя');
  $('objectDescription').placeholder=isEnvironment?
   'Где происходит действие? Пространство, настроение, время суток, постоянные детали среды.':
   'Кто этот герой? Внешность, характер, одежда, постоянные черты и детали.';
  $('studioLocalAttributeTitle').textContent=isEnvironment?
   'Характеристики среды · место, свет, детали':
   'Характеристики героя · внешность, одежда, характер';
  const submit=form.querySelector('.object-primary');
  if(submit)submit.textContent=existing?'Сохранить изменения':'Сохранить объект';
 }
 openObjectEditor=function(id=null,kind='character'){
  studioLocalEditingObjectNode=null;
  savedOriginalOpen(id,kind);
  syncModal();
 };
 closeObjectEditor=function(){
  studioLocalEditingObjectNode=null;
  savedOriginalClose();
 };
 saveObjectDraft=function(draft){
  const result=savedOriginalSave(draft);
  const nodeId=studioLocalEditingObjectNode;
  if(nodeId){
   const n=findN(nodeId);
   if(n?.type==='object'){
    commit();
    n.objectId=result.id;
    n.objectVersionMode='latest';
    n.objectVersion=null;
    n.title=(result.kind==='environment'?'Среда':'Герой')+' · '+result.name;
    render();
    persist();
   }
   studioLocalEditingObjectNode=null;
  }
  return result;
 };
 function openFromNode(nodeId){
  const n=findN(nodeId);
  if(n?.type!=='object')return;
  const existing=n.objectId?getObject(n.objectId):null;
  // Call the underlying editor directly; the library wrapper deliberately
  // resets the target when opening an unrelated library object.
  studioLocalEditingObjectNode=nodeId;
  savedOriginalOpen(existing?.id||null,existing?.kind||'character');
  if(!existing){
   const name=(n.title||'').replace(/^(Object|Герой|Среда)\s*·\s*/,'').trim();
   if(name&&name!=='Object'&&name!=='Герой'&&name!=='Среда'){
    $('objectName').value=name;
    editingObjectDraft.name=name;
   }else{
    $('objectName').value='';
    editingObjectDraft.name='';
   }
  }
  syncModal();
  $('objectName').focus();
 }
 addNode=function(type,x,y,quiet=false){
  const n=savedOriginalAddNode(type,x,y,quiet);
  if(type==='object'&&n&&!quiet){
   setTimeout(()=>{
    if(!$('objectModal').classList.contains('hidden'))return;
    if(!findN(n.id))return;
    openFromNode(n.id);
   },0);
  }
  return n;
 };
 // Click anywhere on the object card (including the original misleading
 // "choose object" button) to open its actual editor, not only Inspector.
 nodeLayer.addEventListener('click',event=>{
  const card=event.target.closest?.('.node-object .object-canvas-card');
  if(!card)return;
  const el=card.closest('.node-object');
  if(!el)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openFromNode(el.dataset.node);
 },true);
 nodeLayer.addEventListener('dblclick',event=>{
  const head=event.target.closest?.('.node-object .node-head');
  if(!head)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openFromNode(head.closest('.node-object').dataset.node);
 },true);
 // Clicking a saved library entry also opens its editor; actions remain intact.
 $('objectList').addEventListener('click',event=>{
  const el=event.target.closest?.('[data-object-item]');
  if(!el||event.target.closest('button,input,label,a'))return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openObjectEditor(el.dataset.objectItem);
 },true);
 kindField.addEventListener('change',syncModal);
 window.STUDIO_LOCAL_OBJECT_UI={openNode:openFromNode};
}
