import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMinimalGraph,buildLocalHTML,MODEL,localSamplingSteps} from '../pilot/local-free-mvp.mjs';
import {validateGraph} from '../pilot/core.mjs';
test('the public seed has exactly two clean nodes and one TEXT edge',async()=>{
 const seed=JSON.parse(await readFile(new URL('../pilot/seed.json',import.meta.url),'utf8'));
 assert.equal(seed.nodes.length,2);assert.equal(seed.objects.length,0);assert.equal(seed.inbox.length,0);
 const graph=createMinimalGraph(seed);validateGraph(graph,'proj_studio_local_free_mvp');
 assert.deepEqual(graph.nodes.map(x=>x.type),['prompt','generator']);assert.equal(graph.edges.length,1);
});
test('the local UI exposes AI Image and JSON features without cloud publishing',async()=>{
 const raw=await readFile(new URL('../lib/canvas-html.ts',import.meta.url),'utf8');
 const html=buildLocalHTML(JSON.parse(raw.replace(/^export const canvasHTML=/,'').replace(/;\s*$/,'')));
 assert.match(html,/studioLocalObjectJSONUIInit/);assert.match(html,/studioLocalJSONTemplate/);
 assert.match(html,/AI Image/);
});
test('image generator is local FLUX.2, high quality at four steps',()=>{
 assert.equal(MODEL,'x/flux2-klein:4b');assert.equal(localSamplingSteps('high'),4);
});
