import test, {after, afterEach, before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';

const frontendRoot=fileURLToPath(new URL('..',import.meta.url));
const oldGlobals=new Map();
let dom, tempDirectory, Panel, createRoot, root, container, requests, changes, props;
const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const shape=(width=3,role='extension')=>({id:'addition',label:'Ampliación',role,geometry:{type:'Polygon',coordinates:[ring(4,-2,width,4)]}});
const snapshot=()=>({coordinateSpace:'local_metres',source:{documentName:'standalone.dwg',viewName:'Model',entityId:'42'},scale:{metresPerUnit:.001,method:'unit',unit:'mm'},origin:[0,0],
  footprint:{type:'Polygon',coordinates:[ring(-5,-4,10,8)]},shapes:[shape()]});
const parcel={type:'FeatureCollection',features:[{type:'Feature',properties:{n_predio:'123456'},geometry:{type:'Polygon',coordinates:[ring(-78.5,-.2,.0003,.0003)]}}]};
const irm=()=>({candidate_irm_fields:{predio:{raw:'123456'},area_terreno:{raw:'1000',page:2},cos_pb:{raw:'50',page:3}}});
const response=(area=80)=>({status:'preliminary',verified:false,metrics:{existing_footprint_m2:area,extension_added_m2:8,combined_footprint_m2:area+8},checks:[
  {id:'identity',status:'pending',title:'Correspondencia documental',message:'Falta confirmar los documentos.'}],placed:null,warnings:[]});

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://predio.test/'});
  const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT:true,fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,...options,resolve,reject}))};
  for(const [name,value]of Object.entries(globals)){oldGlobals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});}
  ({createRoot}=await import('react-dom/client'));
  const output=await build({configFile:false,root:frontendRoot,logLevel:'silent',plugins:[{name:'map-test-boundary',enforce:'pre',
    resolveId(source){if(source.endsWith('/FootprintMap.jsx'))return '\0footprint-map-test';},
    load(id){if(id==='\0footprint-map-test')return `import React from 'react';export default function Map(){return React.createElement('div',{'data-testid':'placement-map'},'Mapa de implantación');}`;}}],
    build:{ssr:join(frontendRoot,'src/components/FootprintPlanner.jsx'),write:false,target:'node20',minify:false}});
  const cacheRoot=join(frontendRoot,'node_modules/.cache/predio-component-tests');await mkdir(cacheRoot,{recursive:true});tempDirectory=await mkdtemp(join(cacheRoot,'footprint-'));
  for(const item of output.output)if(item.type==='chunk'){await mkdir(join(tempDirectory,item.fileName,'..'),{recursive:true});await writeFile(join(tempDirectory,item.fileName),item.code);}
  const entry=output.output.find(item=>item.type==='chunk'&&item.isEntry);
  ({default:Panel}=await import(pathToFileURL(join(tempDirectory,entry.fileName)).href));
});
beforeEach(async()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);requests=[];changes=[];
  props={snapshot:snapshot(),apiBase:'https://api.predio.test'};await render();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
after(async()=>{dom?.window.close();for(const[name,descriptor]of oldGlobals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}if(tempDirectory)await rm(tempDirectory,{recursive:true,force:true});});
async function render(extra={}){props={...props,...extra};await act(async()=>root.render(React.createElement(Panel,{...props,onStateChange:value=>changes.push(value)})));}
async function settle(){await act(async()=>new Promise(resolve=>setTimeout(resolve,340)));}
function button(label){const el=[...container.querySelectorAll('button')].find(el=>el.textContent.includes(label));assert.ok(el,`button ${label}`);return el;}
async function click(label){await act(async()=>button(label).click());}
function input(label){const el=[...container.querySelectorAll('input,select')].find(el=>el.labels?.[0]?.textContent.startsWith(label));assert.ok(el,`input ${label}`);return el;}
async function value(label,text){const el=input(label);await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,text);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function check(label){await act(async()=>input(label).click());}
async function complete(request,payload){await act(async()=>request.resolve({ok:true,json:async()=>payload}));}

test('drawing-only study shows a useful local footprint and never invents the missing predio or IRM',async()=>{
  await settle();assert.equal(requests.length,1);
  const request=JSON.parse(requests[0].body);assert.equal(request.parcel,null);assert.equal(request.irm.provided,false);
  assert.match(container.textContent,/80/);assert.equal(container.querySelectorAll('.footprint-local-preview svg').length,1);
  await click('Ubicar en el predio');assert.match(container.textContent,/Falta el predio/);
  await click('Revisar con el IRM');assert.match(container.textContent,/IRM de este plano todavía no está disponible/);
  assert.equal(container.querySelectorAll('[data-testid="placement-map"]').length,0);
});

test('a missing confirmed footprint creates no network request or pretend polygon',async()=>{
  await render({snapshot:null});await settle();assert.equal(requests.length,0);
  assert.match(container.textContent,/elige el contorno de planta baja/);assert.equal(container.querySelectorAll('.footprint-metrics').length,0);
});

test('late API responses never replace a newer source or show old parcel checks',async()=>{
  await settle();const old=requests[0];
  const next=snapshot();next.source.documentName='another.dwg';next.footprint={type:'Polygon',coordinates:[ring(-2,-2,4,4)]};
  await render({snapshot:next});assert.equal(old.signal.aborted,true);await settle();const latest=requests[1];
  await complete(latest,response(16));await complete(old,response(999));
  const metrics=container.querySelector('.footprint-metrics').textContent;assert.match(metrics,/16/);assert.doesNotMatch(metrics,/999/);
});

test('a changed extension clears reviewed counted areas without moving the placed footprint',async()=>{
  await render({parcel,parcelProperties:{n_predio:'123456'},irm:irm()});
  await click('Ubicar en el predio');assert.ok(container.querySelector('[data-testid="placement-map"]'));await value('Giro horario','35');await value('Latitud del origen','-0.20005');
  await click('Revisar con el IRM');await value('Área útil/computable final en planta baja','75');await value('Área computable final de todos los pisos','140');
  await render({snapshot:{...props.snapshot,shapes:[shape(),{...shape(2,'furniture'),id:'table'}]}});
  assert.equal(input('Área útil/computable final en planta baja').value,'75','a furniture-only edit does not change countable building areas');
  await render({snapshot:{...props.snapshot,shapes:[shape(6)]}});
  assert.equal(input('Área útil/computable final en planta baja').value,'');assert.equal(input('Área computable final de todos los pisos').value,'');
  assert.match(container.textContent,/Cambió la ampliación/);
  const current=changes.at(-1);assert.equal(current.draft.placement.rotation_degrees,'35');assert.equal(current.draft.placement.latitude,'-0.20005');
  await settle();const request=JSON.parse(requests.at(-1).body);assert.equal(request.proposal.ground_floor_counted_area_m2,null);assert.equal(request.proposal.total_floor_area_m2,null);
});

test('a later IRM retains placement while clearing documentary review and countable area assumptions',async()=>{
  await render({parcel,parcelProperties:{n_predio:'123456'},irm:irm()});
  await click('Ubicar en el predio');await value('Giro horario','28');await value('Longitud del origen','-78.49991');
  await click('Revisar con el IRM');await check('Contrasté los valores');await value('Área útil/computable final en planta baja','70');
  const replacement=irm();replacement.candidate_irm_fields.cos_pb={raw:'40',page:4};
  await render({irm:replacement});assert.equal(input('COS en planta baja').value,'40');assert.equal(input('Contrasté los valores').checked,false);
  assert.equal(input('Área útil/computable final en planta baja').value,'');
  assert.equal(changes.at(-1).draft.placement.rotation_degrees,'28');assert.equal(changes.at(-1).draft.placement.longitude,'-78.49991');
  assert.match(container.textContent,/Conservamos la posición/);
});

test('known identifier disagreement is visible and cannot be confirmed into an association',async()=>{
  const other=irm();other.candidate_irm_fields.predio={raw:'999999'};
  await render({parcelProperties:{n_predio:'123456'},irm:other});await click('Revisar con el IRM');
  assert.match(container.textContent,/identificadores de predio no coinciden/);
  assert.equal(input('Confirmo que este plano').disabled,true);
  await settle();assert.equal(JSON.parse(requests.at(-1).body).irm.association_confirmed,false);
});

test('a remounted workspace preserves the exact draft and current response for the same inspection',async()=>{
  await render({irm:irm()});await click('Revisar con el IRM');await value('Área útil/computable final en planta baja','74');await settle();
  await complete(requests.at(-1),response());const saved=changes.at(-1);
  await act(async()=>root.unmount());root=createRoot(container);await render({state:saved});
  assert.equal(input('Área útil/computable final en planta baja').value,'74');
  assert.equal(container.querySelectorAll('.footprint-check-list').length,1);
});
