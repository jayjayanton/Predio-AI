import test, {after, afterEach, before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';

const frontendRoot=fileURLToPath(new URL('..',import.meta.url));
const saved=new Map();
const realNow=Date.now;
let dom,directory,SearchResultsLayer,VisibleParcels,createRoot,root,container,fixture,clock;
const feature=(id,x=.0049)=>({type:'Feature',id,properties:{predio:String(id),n_predio:String(id)},
  geometry:{type:'Polygon',coordinates:[[[x,.001],[x+.0002,.001],[x+.0002,.0015],[x,.0015],[x,.001]]]}});
const collection=features=>({type:'FeatureCollection',features});

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://predio.test/'});
  const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
    __parcelMapFixture:null,
    fetch:(url,options)=>new Promise((resolve,reject)=>{
      const request={url,...options,resolve,reject};fixture.requests.push(request);
      options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
    })};
  for(const [name,value] of Object.entries(globals)){
    saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  ({createRoot}=await import('react-dom/client'));
  const output=await build({configFile:false,root:frontendRoot,logLevel:'silent',ssr:{noExternal:['leaflet','react-leaflet']},
    plugins:[{name:'map-contract-test',enforce:'pre',
      resolveId(id){if(id==='leaflet'||id==='react-leaflet')return '\0map-contract-'+id;},
      load(id){
        if(id==='\0map-contract-react-leaflet')return `import React,{useState,useImperativeHandle,forwardRef} from 'react';
          export const useMap=()=>globalThis.__parcelMapFixture.map;
          export const MapContainer=({children})=>children;
          export const TileLayer=()=>null;export const ScaleControl=()=>null;
          // Real React-Leaflet GeoJSON treats data as immutable. Keeping only
          // mount data catches updates that fail to replace the actual layer.
          export const GeoJSON=forwardRef(function GeoJSON({data,className},ref){
            const [mounted]=useState(data);
            const [layers]=useState(()=>mounted.features.map(feature=>({feature,bringToFront(){globalThis.__parcelMapFixture.fronts.push(String(feature.properties.n_predio));}})));
            useImperativeHandle(ref,()=>({eachLayer(callback){layers.forEach(callback);}}),[layers]);
            return React.createElement('output',{'data-layer':className||'search'},JSON.stringify(mounted));});`;
        if(id==='\0map-contract-leaflet')return `const latLng=(lat,lng)=>({lat,lng,distanceTo(other){return Math.hypot(lat-other.lat,lng-other.lng);}});
          export default {latLng,latLngBounds:coordinates=>({coordinates}),GeometryUtil:{geodesicArea(){globalThis.__parcelMapFixture.areaCalls++;return 10;}},DomEvent:{stopPropagation(){}}};`;
      },
      transform(code,id){if(id.endsWith('/src/components/ParcelMap.jsx'))return code+'\nexport {SearchResultsLayer,VisibleParcels};';}
    }],build:{ssr:join(frontendRoot,'src/components/ParcelMap.jsx'),write:false,target:'node20',minify:false}});
  const entry=output.output.find(item=>item.type==='chunk'&&item.isEntry);
  const cache=join(frontendRoot,'node_modules/.cache/predio-component-tests');await mkdir(cache,{recursive:true});
  directory=await mkdtemp(join(cache,'parcel-map-'));
  for(const item of output.output)if(item.type==='chunk'){
    const path=join(directory,item.fileName);await mkdir(dirname(path),{recursive:true});await writeFile(path,item.code);
  }
  ({SearchResultsLayer,VisibleParcels}=await import(pathToFileURL(join(directory,entry.fileName)).href));
});
beforeEach(()=>{
  const events=new Map();clock=0;Date.now=()=>clock;
  fixture={requests:[],views:[],fits:[],fronts:[],areaCalls:0,map:{
    on:(name,callback)=>events.set(name,callback),off:name=>events.delete(name),
    getZoom:()=>17,getBounds:()=>({getWest:()=>.0049,getSouth:()=>.0001,getEast:()=>.0051,getNorth:()=>.0049}),
    invalidateSize:()=>{},setView:(...args)=>fixture.views.push(args),fitBounds:(...args)=>fixture.fits.push(args),
    move:()=>events.get('moveend')?.()
  }};
  globalThis.__parcelMapFixture=fixture;
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();Date.now=realNow;});
after(async()=>{
  dom?.window.close();Date.now=realNow;
  for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  if(directory)await rm(directory,{recursive:true,force:true});
});
const render=(Component,props)=>act(async()=>root.render(React.createElement(Component,props)));
const waitDebounce=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,320));});
const finish=(request,payload)=>act(async()=>request.resolve({ok:true,json:async()=>payload}));

test('overview append and temporary empty filters preserve camera, while a new query or new selection still focuses',async()=>{
  const first=feature(1),other=feature(2,.00495);
  await render(SearchResultsLayer,{results:collection([first]),queryKey:'query-a'});
  assert.equal(fixture.views.length,1);
  await render(SearchResultsLayer,{results:collection([first]),queryKey:'query-a',selected:'1'});
  assert.equal(fixture.fits.length,1);
  // The user can pan after selection; later overview data must not reset it.
  await render(SearchResultsLayer,{results:collection([first,other]),queryKey:'query-a',selected:'1'});
  assert.equal(fixture.views.length,1);assert.equal(fixture.fits.length,1);
  await render(SearchResultsLayer,{results:collection([]),queryKey:'query-a'});
  await render(SearchResultsLayer,{results:collection([first,other]),queryKey:'query-a'});
  assert.equal(fixture.views.length,1,'clearing an empty evidence filter does not recenter');
  await render(SearchResultsLayer,{results:collection([first,other]),queryKey:'query-a',selected:'2'});
  assert.equal(fixture.fits.length,2);
  await render(SearchResultsLayer,{results:collection([other]),queryKey:'query-b'});
  assert.equal(fixture.views.length,2,'a genuinely new query gets its initial neighborhood view');
});

test('selected PH geometry stays above coincident parcels after overview replacement without moving the camera again',async()=>{
  // Several PH records can legitimately share one cadastral lot outline.
  const records=Array.from({length:14},(_,index)=>feature(1234871+index));
  await render(SearchResultsLayer,{results:collection(records),queryKey:'ph-query'});
  assert.equal(fixture.fronts.length,0);
  await render(SearchResultsLayer,{results:collection(records),queryKey:'ph-query',selected:'1234871'});
  assert.deepEqual(fixture.fronts,['1234871'],'only the explicit selection is raised above other records');
  assert.equal(fixture.fits.length,1);
  await render(SearchResultsLayer,{results:collection([...records,feature(2000000)]),queryKey:'ph-query',selected:'1234871'});
  assert.deepEqual(fixture.fronts,['1234871','1234871'],'a newly mounted overview restores the selected layer to the front');
  assert.equal(fixture.fits.length,1,'restoring draw order does not refocus an unchanged selection');
  assert.equal(fixture.views.length,1,'the same query keeps its current camera');
});

test('same-ID geometry refresh replaces the mounted nearby layer even while an overlapping tile keeps the old feature visible',async()=>{
  await render(VisibleParcels,{enabled:true});await waitDebounce();
  assert.equal(fixture.requests.length,2,'the viewport straddles two fixed tiles');
  await finish(fixture.requests[0],collection([feature(77)]));
  clock=1000;await finish(fixture.requests[1],collection([feature(77)]));
  const shown=()=>JSON.parse(container.querySelector('[data-layer="predio-nearby-interactive"]').textContent).features[0];
  assert.equal(shown().geometry.coordinates[0][0][0],.0049);
  clock=900001;await act(async()=>fixture.map.move());
  assert.equal(shown().id,77,'the unexpired overlapping tile preserves the visible feature during refresh');
  await waitDebounce();assert.equal(fixture.requests.length,3,'only the expired tile is downloaded');
  await finish(fixture.requests[2],collection([feature(77,.00493)]));
  assert.equal(shown().id,77);
  assert.equal(shown().geometry.coordinates[0][0][0],.00493,'changed geometry reaches the mounted map layer despite unchanged ID');
});

test('geometry highlighting does no area work while off and reuses computed areas across unrelated rerenders',async()=>{
  const criteria={min:'1',max:'20',landClass:'all',housingType:'all',occupation:'all'};
  await render(VisibleParcels,{enabled:true,criteria,highlightMatches:false});await waitDebounce();
  for(const request of fixture.requests)await finish(request,collection([feature(5)]));
  assert.equal(fixture.areaCalls,0);
  await render(VisibleParcels,{enabled:true,criteria,highlightMatches:true});
  assert.equal(fixture.areaCalls,1);
  await render(VisibleParcels,{enabled:true,criteria,highlightMatches:true,queryActive:true});
  assert.equal(fixture.areaCalls,1,'changing interactivity does not repeat geodesic calculations');
});
