import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPredioCandidatesFromPages } from '../src/predioPdfImport.js';

test('labelled predio numbers are deduplicated and linked to source pages',()=>{
 const parsed=extractPredioCandidatesFromPages([{page:1,lines:['Número de predio: 627739 Clave catastral: 0012345678','Predio N° 123456','Predio 627739']},{page:2,lines:['n_predio: 332211']}]);
 assert.deepEqual(parsed.candidates.map(p=>p.n_predio),['627739','123456','332211']);
 assert.equal(parsed.candidates[0].page,1);
 assert.equal(parsed.candidates[0].clave_cata,'0012345678');
});
test('requires predio label; ignores unrelated amounts, years and ID cards',()=>{
 const parsed=extractPredioCandidatesFromPages([{page:1,lines:['Cédula 1712345678','Año 2024','Avalúo $300000','Número 1503322110','Lote 123456']}]);
 assert.equal(parsed.candidates.length,0);assert.ok(parsed.warnings.length);
});
test('parses table candidates only after labelled header',()=>{
 const result=extractPredioCandidatesFromPages([{page:1,lines:['Nº de predio','123456  CUMBAYÁ','987654  TUMBACO','Total 2','999999 sin encabezado']}]);
 assert.deepEqual(result.candidates.map(p=>p.n_predio),['123456','987654']);
});
test('multiple predios in one line do not attach an ambiguous cadastral key',()=>{
 const result=extractPredioCandidatesFromPages([{page:1,lines:['Predio: 123456  Predio: 234567 Clave catastral: 0012345678']}]);
 assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].clave_cata,'');
});
