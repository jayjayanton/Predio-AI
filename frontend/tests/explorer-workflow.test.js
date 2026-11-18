import test, {after, afterEach, before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';

const frontendRoot=fileURLToPath(new URL('..',import.meta.url));
const previousGlobals=new Map();
let dom,tempDirectory,App,createRoot,root,container,requests=[];
const collection=(offset,size)=>({type:'FeatureCollection',features:Array.from({length:size},(_,i)=>({
  type:'Feature',id:offset+i+1,properties:{fid:offset+i+1,n_predio:String(offset+i+1),parroquia:'CUMBAYA',area_terre:600},
  geometry:{type:'Polygon',coordinates:[[[-78.4,-.2],[-78.399,-.2],[-78.399,-.199],[-78.4,-.199],[-78.4,-.2]]]}
}))});

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://predio.test/#explorar'});
  const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
    ResizeObserver:class{observe(){}disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true,
    fetch:(url,options={})=>{
      const params=Object.fromEntries(new URL(url).searchParams);
      if(params.returnDistinctValues)return Promise.resolve({ok:true,json:async()=>({features:[]})});
      return new Promise((resolve,reject)=>{
        const request={url,params,...options,resolve,reject};requests.push(request);
        options.signal?.addEventListener('abort',()=>{if(!request.ignoreAbort)reject(new DOMException('cancelled','AbortError'));},{once:true});
      });
    }
  };
  for(const [name,value] of Object.entries(globals)){
    previousGlobals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  dom.window.scrollTo=()=>{};dom.window.matchMedia=()=>({matches:false});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};dom.window.HTMLElement.prototype.scrollTo=()=>{};
  ({createRoot}=await import('react-dom/client'));
  const output=await build({configFile:false,root:frontendRoot,logLevel:'silent',
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('https://predio-api.test')},
    plugins:[{name:'inspect-map-data-in-explorer-test',enforce:'pre',
      resolveId(id){if(id.endsWith('/ParcelMap.jsx'))return '\0explorer-test-map';},
      load(id){if(id==='\0explorer-test-map')return `import React from 'react';export default function ParcelMap(props){return React.createElement('output',{'data-testid':'map-results','data-selected':props.selectedSearchPredio||''},JSON.stringify((props.searchResults?.features||[]).map(f=>String(f.properties.n_predio))));}`;}
    }],build:{ssr:join(frontendRoot,'src/App.jsx'),write:false,target:'node20',minify:false}});
  const entry=output.output.find(item=>item.type==='chunk'&&item.isEntry);
  const cacheRoot=join(frontendRoot,'node_modules/.cache/predio-component-tests');await mkdir(cacheRoot,{recursive:true});
  tempDirectory=await mkdtemp(join(cacheRoot,'explorer-'));
  for(const item of output.output)if(item.type==='chunk'){
    const path=join(tempDirectory,item.fileName);await mkdir(dirname(path),{recursive:true});await writeFile(path,item.code);
  }
  ({default:App}=await import(pathToFileURL(join(tempDirectory,entry.fileName)).href));
});
beforeEach(async()=>{
  requests=[];dom.window.history.replaceState(null,'','#explorar');
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(React.createElement(App)));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
after(async()=>{
  dom?.window.close();
  for(const [name,descriptor] of previousGlobals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  if(tempDirectory)await rm(tempDirectory,{recursive:true,force:true});
});
function button(name){const found=[...container.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(name));assert.ok(found,`button ${name}`);return found;}
async function click(name){await act(async()=>button(name).click());}
async function finish(request,payload,status=200){await act(async()=>request.resolve({ok:status<400,status,json:async()=>payload}));}
async function setSelect(select,value){assert.ok(select);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(select,String(value));select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
function mapIds(){return JSON.parse(container.querySelector('[data-testid="map-results"]').textContent);}
async function firstPage(count=1500){
  await click('Buscar predios →');
  await finish(requests.find(r=>r.params.returnCountOnly),{count});
  await finish(requests.find(r=>r.params.resultOffset==='0'),collection(0,Math.min(50,count)));
}
async function fullOverview(){await firstPage();await finish(requests.at(-1),collection(50,950));}

test('first page is usable while optional overview is pending, and an overview failure preserves it',async()=>{
  await firstPage();
  assert.equal(container.querySelectorAll('[data-predio-id]').length,50);
  assert.equal(button('Siguientes 50').disabled,false);
  assert.equal(mapIds().length,50);
  assert.deepEqual([requests.at(-1).params.resultOffset,requests.at(-1).params.resultRecordCount],['50','950']);
  await finish(requests.at(-1),{detail:'upstream failure'},503);
  assert.equal(container.querySelectorAll('[data-predio-id]').length,50);
  assert.equal(mapIds().length,50);
  assert.match(container.textContent,/La lista y los polígonos de la página actual siguen disponibles/);
  assert.equal(button('Siguientes 50').disabled,false);
});

test('changing card layout reuses the overview and later-page polygons remain selectable',async()=>{
  await fullOverview();assert.equal(requests.length,3);
  await click('Iconos');
  await setSelect(container.querySelector('.predio-reel-heading .predio-page-size select'),200);
  assert.equal(requests.length,3,'no count or geometry download for view/page size changes');
  for(let i=0;i<4;i++)await click('Siguientes 200');
  assert.equal(requests.length,3,'cached pages through offset 800 are reused');
  await click('Siguientes 200');
  assert.equal(requests.length,4);assert.equal(requests.at(-1).params.resultOffset,'1000');
  await finish(requests.at(-1),collection(1000,200));
  assert.equal(mapIds().length,1200);assert.ok(mapIds().includes('1001'));
  await act(async()=>container.querySelector('[data-predio-id="1001"]').click());
  assert.equal(container.querySelector('[data-testid="map-results"]').dataset.selected,'1001');
});

test('larger map choice fetches only missing rows and keeps the original default',async()=>{
  await fullOverview();const limit=container.querySelector('[aria-label="Polígonos en el mapa"]');
  assert.equal(limit.value,'1000');
  await setSelect(limit,2000);
  assert.deepEqual([requests.at(-1).params.resultOffset,requests.at(-1).params.resultRecordCount],['1000','500']);
  await finish(requests.at(-1),collection(1000,500));
  assert.equal(mapIds().length,1500);
  await setSelect(limit,1000);assert.equal(mapIds().length,1000);assert.equal(requests.length,4);
});

test('clearing discovery cancels overview and PUGS and ignores late responses',async()=>{
  await firstPage();const overview=requests.at(-1);overview.ignoreAbort=true;
  await click('Revisar zonificación de esta página');
  const pugs=requests.at(-1);pugs.ignoreAbort=true;assert.match(pugs.url,/pugs\/spatial-screen$/);
  await click('Limpiar búsqueda · Nueva consulta ↑');
  assert.equal(overview.signal.aborted,true);assert.equal(pugs.signal.aborted,true);
  await finish(overview,collection(50,950));
  await finish(pugs,{screened:50,results:[{predio:'1',status:'single_zone',zones:[{cod_edi_es:'VU'}]}]});
  assert.equal(mapIds().length,0);assert.equal(container.querySelectorAll('[data-predio-id]').length,0);
  assert.equal(container.querySelector('.advanced-pugs-filter'),null);
});
