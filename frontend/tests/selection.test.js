import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTION_LIMIT, COMPARISON_LIMIT, mergeSelection, parseSelection, selectionCSV, selectionRecord } from '../src/selection.js';

const savedAt='2026-11-17T12:00:00.000Z';
const parcel=(overrides={})=>({
 n_predio:'627739',clave_cata:'0012345678',parroquia:'CUMBAYÁ',tipo_propi:'PROPIEDAD HORIZONTAL',
 zonificaci:'URBANO',area_terre:2400,area_ter_1:120,area_const:0,frente:24,...overrides
});
function readCSV(text) {
 const rows=[];let row=[],cell='',quoted=false;
 const input=text.replace(/^\uFEFF/,'');
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){
   if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
 }else if(c===','&&!quoted){row.push(cell);cell='';}
 else if(c==='\r'&&input[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++;}
 else cell+=c;}
 row.push(cell);rows.push(row);return rows;
}
test('portfolio stores 100 entries while comparison remains a 4-column choice',()=>{
 assert.equal(SELECTION_LIMIT,100);assert.equal(COMPARISON_LIMIT,4);
});
test('normalizes numbers and retains genuine zeros',()=>{
 const r=selectionRecord(parcel({area_terre:'2400.5',area_ter_1:'',area_const:0,frente:undefined}),savedAt);
 assert.equal(r.area_terre,2400.5);assert.equal(r.area_ter_1,null);assert.equal(r.area_const,0);assert.equal(r.frente,null);
});
test('missing and invalid measurements are never fabricated as zero',()=>{
 for(const value of [null,undefined,'','   ',false,true,[],[5],{},'sin datos',NaN,Infinity,-1]){
  const r=selectionRecord(parcel({area_terre:value,area_ter_1:value,area_const:value,frente:value}),savedAt);
  for(const k of ['area_terre','area_ter_1','area_const','frente'])assert.equal(r[k],null,String(value));
 }
});
test('retains attributed PH area distinct from parent lot',()=>{
 const r=selectionRecord(parcel({area_ter_1:null}),savedAt);
 assert.equal(r.area_terre,2400);assert.equal(r.area_ter_1,null);
});
test('rejects invalid IDs and does not persist arbitrary owner or PDF fields',()=>{
 for(const p of [null,{}, {n_predio:'abc'},{n_predio:'../123'},{n_predio:'1'.repeat(26)}])
  assert.equal(selectionRecord(p),null);
 const p=selectionRecord(parcel({owner:'Private',id_card:'secret',pdf:'secret',extractedText:'confidential',source:'pdf'}),savedAt);
 assert.deepEqual(Object.keys(p).sort(),['n_predio','clave_cata','parroquia','tipo_propi','zonificaci','area_terre','area_ter_1','area_const','frente','savedAt','source','irmReview'].sort());
 assert.equal(p.source,'pdf');assert.equal(p.irmReview,'pending');
});
test('storage errors are handled and old v1 entries remain valid',()=>{
 for(const raw of [undefined,null,'','{','null','{}','"text"','42','true'])assert.deepEqual(parseSelection(raw),[]);
 const [p]=parseSelection(JSON.stringify([parcel({savedAt,source:undefined})]));
 assert.equal(p.source,'catastro');assert.equal(p.irmReview,'pending');
});
test('restoration removes duplicates, invalid entries and enforces 100 maximum',()=>{
 const all=[parcel({n_predio:'1',parroquia:'First record',savedAt}),null,{n_predio:'bad'},
 parcel({n_predio:'1',parroquia:'Duplicate record',savedAt}),
 ...Array.from({length:120},(_,i)=>parcel({n_predio:String(i+2),savedAt}))];
 const r=parseSelection(JSON.stringify(all));
 assert.equal(r.length,100);assert.equal(r[0].n_predio,'1');assert.equal(r[0].parroquia,'First record');
 assert.equal(r.at(-1).n_predio,'100');
});
test('invalid date replaced safely',()=>{
 const [r]=parseSelection(JSON.stringify([parcel({savedAt:'bad date'})]));
 assert.ok(Number.isFinite(Date.parse(r.savedAt)));
});
test('PDF imports remain sparse and do not imply official cadastral facts',()=>{
 const r=selectionRecord({n_predio:'992233',source:'pdf'});
 assert.equal(r.clave_cata,'');assert.equal(r.parroquia,'');assert.equal(r.area_terre,null);
 assert.equal(r.irmReview,'pending');
});
test('merge adds new IDs and counts duplicates/invalids without erasing existing records',()=>{
 const current=[selectionRecord(parcel({n_predio:'10'}),savedAt)];
 const {records,added,duplicates,rejected,full}=mergeSelection(current,[{n_predio:'10',source:'pdf'},{n_predio:'11',source:'pdf'},{n_predio:'abc'}]);
 assert.equal(added,1);assert.equal(duplicates,1);assert.equal(rejected,1);assert.equal(full,0);
 assert.equal(records[0].source,'catastro');assert.equal(records[1].source,'pdf');
});
test('full portfolio declines excess entries',()=>{
 const existing=Array.from({length:100},(_,i)=>selectionRecord({n_predio:String(i+1)}));
 const result=mergeSelection(existing,[{n_predio:'200'},{n_predio:'201'}]);
 assert.equal(result.added,0);assert.equal(result.full,2);assert.equal(result.records.length,100);
});
test('manual IRM status is only explicit manual-reviewed marker',()=>{
 assert.equal(selectionRecord({n_predio:'1',irmReview:'reviewed'}).irmReview,'pending');
 assert.equal(selectionRecord({n_predio:'1',irmReview:'manual_reviewed'}).irmReview,'manual_reviewed');
});
test('CSV preserves missing values, official-versus-PDF source and manual status',()=>{
 const original=selectionRecord(parcel({area_ter_1:null,frente:null}),savedAt);
 const imported=selectionRecord({n_predio:'123456',source:'pdf'},savedAt);
 const rows=readCSV(selectionCSV([original,imported]));
 assert.equal(rows.length,3);assert.equal(rows[0].length,12);
 assert.deepEqual(rows[1].slice(0,10),['627739','0012345678','CUMBAYÁ','PROPIEDAD HORIZONTAL','URBANO','2400','','0','',savedAt]);
 assert.match(rows[1][10],/Catastro municipal/);
 assert.match(rows[2][10],/PDF importado/);
 assert.equal(rows[2][5],'');assert.equal(rows[2][11],'Pendiente');
});
test('CSV ordinary parcel does not imply attributed PH area',()=>{
 const rows=readCSV(selectionCSV([selectionRecord(parcel({tipo_propi:'UNIPROPIEDAD',area_ter_1:120}),savedAt)]));
 assert.equal(rows[1][6],'');
});
test('CSV formula prefixes, punctuation, accents and line breaks stay safe',()=>{
 const detail='Cumbayá, sector "La Primavera"\nReferencia';
 const csv=selectionCSV([selectionRecord(parcel({parroquia:detail}),savedAt)]);
 assert.ok(csv.startsWith('\uFEFF'));assert.equal(readCSV(csv)[1][2],detail);
 for(const value of ['=1+1','+SUM(1,2)','-1+1','@SUM(1)','\t=1+1','\r=1+1','\n=1+1']){
  const row=readCSV(selectionCSV([selectionRecord(parcel({parroquia:value}),savedAt)]))[1];
  assert.equal(row[2],"'"+value);
 }
});
test('CSV exports empty header-only file',()=>{
 const rows=readCSV(selectionCSV([]));assert.equal(rows.length,1);assert.equal(rows[0].length,12);
});
