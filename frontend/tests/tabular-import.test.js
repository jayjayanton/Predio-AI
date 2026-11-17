import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, suggestedHeader, candidatesFromColumn } from '../src/tabularImport.js';

test('CSV parses semicolon-separated values and quoted commas',()=>{
 const rows=parseDelimited('Título;;;;\nCédula Catastral;Dirección;Avalúo 2026;Impuesto\n539245;"CALLE, 12";10470.49;8.57\n530212;CALLE B;56680.22;82.13');
 assert.equal(rows[1][0],'Cédula Catastral');assert.equal(rows[2][1],'CALLE, 12');
 assert.deepEqual(candidatesFromColumn(rows,1,0).candidates.map(p=>p.n_predio),['539245','530212']);
});
test('detects predio column after a title row in a tax workbook',()=>{
 const rows=[['Avaluo Total Departamentos'],['Cédula Catastral','Dirección','Avalúo 2026','Impuesto Debido'],['539245','CALLE','10470.49','8.57'],['530212','CALLE B','56680.22','82.13']];
 const header=suggestedHeader(rows);
 assert.deepEqual({row:header.row,col:header.col},{row:1,col:0});
 assert.deepEqual(candidatesFromColumn(rows,header.row,header.col).candidates.map(x=>x.n_predio),['539245','530212']);
});
test('supports alternate column, leading zeros and rejects money or formulas',()=>{
 const rows=[['Nombre','Número de predio','Monto'],['A','000123456','100.25'],['B','987654','150'],['C','1.0E+6','200'],['D','=123456','300'],['E','123456.0','400'],['F','987654','500']];
 assert.equal(suggestedHeader(rows).col,1);
 const result=candidatesFromColumn(rows,0,1);
 assert.deepEqual(result.candidates.map(x=>x.n_predio),['000123456','987654']);
 assert.equal(result.warnings.length,1);
});
test('valuation and taxes are not accepted as predio identifiers',()=>{
 assert.equal(candidatesFromColumn([['Avalúo','Impuesto'],['10470.49','8.57']],0,0).candidates.length,0);
});
test('comma CSV with quoted multiline cells stays intact',()=>{
 const rows=parseDelimited('Predio,Nota\n123456,"A\nB"\n234567,OK');
 assert.equal(rows.length,3);assert.equal(rows[1][1],'A\nB');
});
