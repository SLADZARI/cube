// Public local-only module: original cloud identity allowlist and authorize() omitted.
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const revision=async g=>sha256(new TextEncoder().encode(canonical(g)));
export function assert(condition,message,status=422){if(!condition)throw Object.assign(Error(message),{status});}
export const validId=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id);
export function validateGraph(g,expectedId){
 assert(g?.schema===4&&validId(g.id)&&(!expectedId||g.id===expectedId),'PROJECT_ID_OR_SCHEMA');
 for(const key of ['nodes','edges','objects','objectGroups','globalObjectIds','inbox'])assert(Array.isArray(g[key]),'INVALID_'+key);
 assert(g.nodes.length<=2000&&g.edges.length<=8000,'GRAPH_TOO_LARGE');
 const nodes=new Map(),ports=new Map(),edgeIds=new Set(),targets=new Set(),jobs=new Set();
 for(const n of g.nodes){assert(validId(n.id)&&!nodes.has(n.id),'DUPLICATE_NODE');nodes.set(n.id,n);assert(Array.isArray(n.inputs)&&Array.isArray(n.outputs),'INVALID_PORTS');
  for(const [dir,ps] of [['in',n.inputs],['out',n.outputs]])for(const p of ps){assert(validId(p.id)&&!ports.has(p.id)&&p.dir===dir&&['TEXT','IMAGE','OBJECT','MODEL3D'].includes(p.type),'INVALID_PORT');ports.set(p.id,{...p,nodeId:n.id});}
  const ims=new Set((n.images||[]).map(im=>im.id));assert(ims.size===(n.images||[]).length,'DUPLICATE_IMAGE');
  for(const j of n.jobs||[]){assert(validId(j.id)&&!jobs.has(j.id)&&j.payload?.nodeId===n.id,'INVALID_JOB');jobs.add(j.id);for(const rid of j.resultIds||[])assert(ims.has(rid),'JOB_RESULT_MISSING');}
 }
 const next=new Map(g.nodes.map(n=>[n.id,[]]));
 for(const e of g.edges){const a=ports.get(e.sourcePort),b=ports.get(e.targetPort);assert(validId(e.id)&&!edgeIds.has(e.id),'DUPLICATE_EDGE');edgeIds.add(e.id);assert(a&&b&&a.nodeId===e.source&&b.nodeId===e.target&&a.dir==='out'&&b.dir==='in'&&a.type===b.type&&!targets.has(b.id),'INVALID_EDGE');targets.add(b.id);next.get(e.source).push(e.target);}
 const visiting=new Set(),done=new Set();function visit(id){assert(!visiting.has(id),'GRAPH_CYCLE');if(done.has(id))return;visiting.add(id);for(const target of next.get(id))visit(target);visiting.delete(id);done.add(id);}for(const id of nodes.keys())visit(id);
 const objects=new Set(g.objects.map(o=>o.id)),groups=new Set(g.objectGroups.map(o=>o.id));assert(objects.size===g.objects.length&&groups.size===g.objectGroups.length,'DUPLICATE_OBJECT');
 for(const id of [...objects,...groups])assert(validId(id),'INVALID_OBJECT_ID');
 for(const o of g.objects)assert(Number.isInteger(o.version)&&o.version>0&&Array.isArray(o.revisions)&&Array.isArray(o.references),'INVALID_OBJECT_VERSION');
 for(const group of g.objectGroups)for(const id of group.objectIds||[])assert(objects.has(id),'MISSING_GROUP_OBJECT');
 for(const id of g.globalObjectIds)assert(objects.has(id),'MISSING_GLOBAL_OBJECT');
 for(const n of g.nodes){if(n.objectId)assert(objects.has(n.objectId),'MISSING_OBJECT');if(n.objectGroupId)assert(groups.has(n.objectGroupId),'MISSING_OBJECT_GROUP');for(const b of n.objectBindings||[])assert(objects.has(b.objectId),'MISSING_BINDING');for(const id of n.objectGroupIds||[])assert(groups.has(id),'MISSING_BINDING_GROUP');}
 for(const it of g.inbox){const n=nodes.get(it.nodeId);assert(n&&(n.images||[]).some(i=>i.id===it.imageId),'INVALID_INBOX');if(it.jobId){const j=(n.jobs||[]).find(j=>j.id===it.jobId);assert(j?.resultIds?.includes(it.imageId),'INVALID_INBOX_JOB');}}
 function walk(v){if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(typeof x==='string'&&k==='src')assert(!x||/^\/api\/media\/asset_[A-Za-z0-9_-]+$/.test(x),'NON_PERSISTENT_MEDIA');else if(x&&typeof x==='object')walk(x);}}
 walk(g);return g;
}
export function sniff(bytes){const b=new Uint8Array(bytes);if(b[0]===137&&[80,78,71,13,10,26,10].every((v,i)=>b[i+1]===v))return'image/png';if(b[0]===255&&b[1]===216&&b[2]===255)return'image/jpeg';const s=String.fromCharCode(...b.slice(0,16));if(s.startsWith('RIFF')&&s.slice(8,12)==='WEBP')return'image/webp';if(s.startsWith('glTF'))return'model/gltf-binary';throw Object.assign(Error('UNSUPPORTED_BINARY'),{status:415});}
