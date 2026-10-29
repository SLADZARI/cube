// Pure, browser-compatible JSON contract for Studio Local Objects.
// No file system/network usage. A JSON file never contains original image bytes.
(function(root){
 'use strict';
 const SCHEMA='studio-object/v1';
 const FIELD_KEYS={
  character:['identity','silhouette','face','outfit','palette','expressions','scale','invariants','avoid'],
  environment:['architecture','props','materials','palette','lighting','camera','invariants']
 };
 const TYPE_ALIASES={hero:'character',character:'character',environment:'environment',scene:'environment','герой':'character','среда':'environment'};
 const TYPE_NAMES={character:'hero',environment:'environment'};
 const forbidden=new Set(['__proto__','constructor','prototype']);
 const owns=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.prototype.toString.call(x)==='[object Object]';
 function fail(msg){throw new Error(msg);}
 function resolveKind(value){
  if(typeof value!=='string')fail('Тип объекта должен быть строкой hero или environment');
  const key=value.toLowerCase().trim();
  const kind=Object.prototype.hasOwnProperty.call(TYPE_ALIASES,key)?TYPE_ALIASES[key]:null;
  if(!kind)fail('Неизвестный тип '+JSON.stringify(value)+'. Используйте hero или environment');
  return kind;
 }
 function safeText(value,path,max){
  if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')fail('Поле '+path+' должно содержать текст');
  const s=String(value);
  if(s.length>max)fail('Слишком длинное поле '+path+' (максимум '+max+' символов)');
  return s;
 }
 function normalizedFields(kind,values,source='fields'){
  if(!isRecord(values))fail(source+' должен быть JSON-объектом');
  const out=Object.create(null);
  const allowed=new Set(FIELD_KEYS[kind]);
  for(const [key,value] of Object.entries(values)){
   if(forbidden.has(key)||!allowed.has(key))fail('Неизвестное поле '+source+'.'+key+' для '+TYPE_NAMES[kind]+'. Скачайте шаблон выбранного типа.');
   out[key]=safeText(value,source+'.'+key,1200);
  }
  return out;
 }
 function normalizedCustom(values){
  if(!isRecord(values))fail('custom должен быть JSON-объектом');
  if(Object.keys(values).length>32)fail('Слишком много дополнительных параметров (максимум 32)');
  const out=Object.create(null);
  for(const [key,value] of Object.entries(values)){
   if(forbidden.has(key)||!/^[-a-zA-Z_][a-zA-Z0-9_-]{0,47}$/.test(key))fail('Недопустимый ключ custom.'+key);
   const item=safeText(value,'custom.'+key,800);
   if(/[\r\n]/.test(item))fail('custom.'+key+' должен быть одной строкой');
   out[key]=item;
  }
  return out;
 }
 function template(kind='character',current=null){
  const normalized=resolveKind(kind);
  const fields=Object.fromEntries(FIELD_KEYS[normalized].map(k=>[k,
   current?.params&&owns(current.params,k)?String(current.params[k]??''):'']));
  return {schema:SCHEMA,type:TYPE_NAMES[normalized],name:current?.name||'',
   description:current?.description||'',fields,custom:{...(current?.custom||{})}};
 }
 function normalize(raw,{current,lockedKind=false}={}){
  if(!isRecord(raw))fail('JSON должен содержать один объект, а не список');
  for(const key of Object.keys(raw)){
   if(forbidden.has(key))fail('Недопустимый ключ JSON: '+key);
   if(['images','image','references','imageData','src','dataUrl','file','files'].includes(key))
    fail('JSON изменяет только описание. Изображения прикрепляйте через «Добавить изображение»; существующие фотографии сохранятся.');
   if(!['schema','type','kind','name','description','fields','params','custom'].includes(key))
    fail('Неизвестный ключ '+key+'. Скачайте шаблон JSON нужного типа.');
  }
  if(owns(raw,'schema')&&raw.schema!==SCHEMA)fail('Неизвестная версия JSON. Ожидается '+SCHEMA);
  if(owns(raw,'type')&&owns(raw,'kind')&&resolveKind(raw.type)!==resolveKind(raw.kind))
   fail('type и kind указывают на разные типы объекта');
  const currentKind=resolveKind(current?.kind||'character');
  const kind=resolveKind(raw.type??raw.kind??currentKind);
  if(lockedKind&&kind!==currentKind)fail('Тип уже сохранённого объекта менять нельзя. Создайте новый объект типа '+TYPE_NAMES[kind]);
  if(owns(raw,'fields')&&owns(raw,'params'))fail('Укажите только fields, без дублирующего params');
  const oldFields=kind===currentKind?(current?.params||{}):{};
  const params={...Object.fromEntries(FIELD_KEYS[kind].map(k=>[k,String(oldFields[k]??'')]))};
  const input=owns(raw,'fields')?raw.fields:owns(raw,'params')?raw.params:null;
  if(owns(raw,'fields')||owns(raw,'params'))Object.assign(params,normalizedFields(kind,input,owns(raw,'fields')?'fields':'params'));
  const oldCustom=kind===currentKind?(current?.custom||{}):{};
  const custom={...oldCustom};
  if(owns(raw,'custom'))Object.assign(custom,normalizedCustom(raw.custom));
  const name=owns(raw,'name')?safeText(raw.name,'name',120):String(current?.name||'');
  const description=owns(raw,'description')?safeText(raw.description,'description',6000):String(current?.description||'');
  return {kind,name,description,params,custom};
 }
 root.StudioLocalObjectJSON=Object.freeze({SCHEMA,FIELD_KEYS,resolveKind,template,normalize});
})(window);
