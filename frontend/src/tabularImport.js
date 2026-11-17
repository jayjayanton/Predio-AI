// Browser-only tabular import. No upload, OCR or automatic owner-data storage.
// Supports CSV, DOCX tables and XLSX worksheets. Legacy .doc/.xls not supported.
export function parseDelimited(text, delimiter) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const sep = delimiter || (((src.split(/\r?\n/).slice(0,5).join('\n').match(/;/g)||[]).length >
    (src.split(/\r?\n/).slice(0,5).join('\n').match(/,/g)||[]).length) ? ';' : ',');
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(c==='"'){if(quoted&&src[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===sep&&!quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&src[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(value||row.length){row.push(value);rows.push(row);}
  return rows;
}
const xmlText = node => node?.textContent || '';
const local = (node,name) => [...(node?.getElementsByTagName('*')||[])].filter(n=>n.localName===name);
const children = (node,name) => [...(node?.children||[])].filter(n=>n.localName===name);
const xml = source => {
  const doc=new DOMParser().parseFromString(source,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('El archivo contiene XML no válido.');
  return doc;
};
async function unzipEntries(bytes, requested) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const names=new Set(requested||[]);
  const files=new Map();
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0)throw new Error('El documento no contiene una estructura ZIP válida.');
  const count=view.getUint16(eocd+10,true), central=view.getUint32(eocd+16,true);
  if(count>3000)throw new Error('Demasiados archivos internos.');
  let pos=central;
  const decoder=new TextDecoder();
  for(let i=0;i<count;i++){
    if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)throw new Error('Directorio ZIP no válido.');
    const method=view.getUint16(pos+10,true),compressed=view.getUint32(pos+20,true),uncompressed=view.getUint32(pos+24,true);
    const nameLen=view.getUint16(pos+28,true),extraLen=view.getUint16(pos+30,true),commentLen=view.getUint16(pos+32,true);
    const offset=view.getUint32(pos+42,true);
    const name=decoder.decode(bytes.subarray(pos+46,pos+46+nameLen));
    pos+=46+nameLen+extraLen+commentLen;
    if((!names.size||names.has(name))&&!name.endsWith('/')){
      if(uncompressed>12*1024*1024)throw new Error('Un componente interno supera el límite permitido.');
      if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw new Error('Entrada ZIP inválida.');
      const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
      if(start+compressed>bytes.length)throw new Error('Datos ZIP incompletos.');
      const payload=bytes.slice(start,start+compressed);
      let data;
      if(method===0)data=payload;
      else if(method===8){
        if(typeof DecompressionStream==='undefined')throw new Error('Tu navegador no admite descompresión de documentos Office.');
        try {
          const stream=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          data=new Uint8Array(await new Response(stream).arrayBuffer());
        } catch { throw new Error('No se pudo descomprimir este documento. Intenta exportarlo a CSV.'); }
      } else throw new Error('Compresión de Office no admitida.');
      if(data.length>12*1024*1024)throw new Error('Documento descomprimido demasiado grande.');
      files.set(name,decoder.decode(data));
    }
  }
  return files;
}
export function extractDocxTables(xmlString) {
  const doc=xml(xmlString);
  const tables=local(doc,'tbl');
  const result=tables.map((table,i)=>({
    name:'Tabla '+(i+1),
    rows:children(table,'tr').map(tr=>children(tr,'tc').map(tc=>
      local(tc,'p').map(p=>local(p,'t').map(xmlText).join('')).join(' ').trim()))
  })).filter(table=>table.rows.length);
  if(result.length)return result;
  const paragraphs=local(doc,'p').map(p=>local(p,'t').map(xmlText).join('')).filter(Boolean);
  return paragraphs.length?[{name:'Párrafos',rows:paragraphs.map(line=>[line])}]:[];
}
function columnIndex(ref) {
  const match=String(ref||'').match(/^[A-Z]+/i);
  if(!match)return -1;
  let n=0;for(const c of match[0].toUpperCase())n=n*26+c.charCodeAt(0)-64;
  return n-1;
}
export function extractXlsxSheet(xmlString, shared=[]) {
  const doc=xml(xmlString), out=[];
  for(const row of local(doc,'row')){
    const rowNumber=Number(row.getAttribute('r'))||out.length+1;
    if(rowNumber>3000)break;
    const values=[];
    for(const c of children(row,'c')){
      const index=columnIndex(c.getAttribute('r'));
      if(index<0||index>80)continue;
      const kind=c.getAttribute('t'),v=children(c,'v')[0];
      const value=kind==='inlineStr'?local(c,'t').map(xmlText).join(''):
        kind==='s'?(shared[Number(xmlText(v))]||''):xmlText(v);
      values[index]=value;
    }
    out[rowNumber-1]=values;
  }
  return out.map(row=>row||[]);
}
export async function readTabularFile(file) {
  if(!file)throw new Error('Selecciona un archivo.');
  if(file.size>15*1024*1024)throw new Error('El archivo supera el límite de 15 MB.');
  const name=file.name?.toLowerCase()||'';
  if(name.endsWith('.csv')){
    const raw=await file.arrayBuffer();
    let text=new TextDecoder('utf-8',{fatal:false}).decode(raw);
    // Excel CSVs sometimes use UTF-16LE with a BOM.
    if(raw.byteLength>=2&&new DataView(raw).getUint16(0,true)===0xfeff)text=new TextDecoder('utf-16le').decode(raw);
    return [{name:'CSV',rows:parseDelimited(text)}];
  }
  if(!/\.(docx|xlsx)$/.test(name))throw new Error('Formatos compatibles: CSV, Word .docx y Excel .xlsx. Los .doc y .xls antiguos requieren conversión.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const entries=await unzipEntries(bytes);
  if(name.endsWith('.docx')){
    const source=entries.get('word/document.xml');
    if(!source)throw new Error('No se encontró contenido de Word.');
    return extractDocxTables(source);
  }
  const workbook=entries.get('xl/workbook.xml');
  if(!workbook)throw new Error('No se encontró el libro de Excel.');
  const sharedXml=entries.get('xl/sharedStrings.xml');
  const shared=sharedXml?local(xml(sharedXml),'si').map(si=>local(si,'t').map(xmlText).join('')):[];
  const wdoc=xml(workbook);
  const relXml=entries.get('xl/_rels/workbook.xml.rels');
  const relations=new Map();
  if(relXml)for(const rel of local(xml(relXml),'Relationship')){
    relations.set(rel.getAttribute('Id'),rel.getAttribute('Target'));
  }
  const sheets=[];
  for(const [index,sheet] of local(wdoc,'sheet').entries()){
    const relId=[...sheet.attributes].find(a=>a.localName==='id')?.value;
    const target=relations.get(relId);
    const path=target?(target.startsWith('/')?target.replace(/^\//,''):'xl/'+target.replace(/^\.\//,'')):'xl/worksheets/sheet'+(index+1)+'.xml';
    const normalized=path.replace(/xl\/\.\.\//g,'');
    const data=entries.get(normalized);
    if(data)sheets.push({name:sheet.getAttribute('name')||'Hoja '+(index+1),rows:extractXlsxSheet(data,shared)});
  }
  if(!sheets.length)throw new Error('No se encontraron hojas legibles en el archivo.');
  return sheets;
}
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function suggestedHeader(rows) {
  let best={row:0,col:0,score:-1};
  rows.slice(0,30).forEach((row,r)=>row.forEach((value,c)=>{
    const label=normalize(value);
    let score=0;
    if(/^(n(umero)? )?predio$/.test(label)||label==='n predio')score=100;
    else if(/^(cedula|clave|codigo) catastral$/.test(label))score=90;
    else if(/predio|catastral/.test(label))score=40;
    if(score>best.score){best={row:r,col:c,score};}
  }));
  return best;
}
export function candidatesFromColumn(rows,headerRow,column) {
  const seen=new Set(),candidates=[],invalid=[];
  for(let i=headerRow+1;i<rows.length;i++){
    const raw=String(rows[i]?.[column]??'').trim();
    if(!raw)continue;
    const compact=raw.replace(/\s/g,'');
    // Excel numeric identifiers may be rendered as 539245.0 or 539245.000.
    // Only strip a fractional part consisting entirely of zeros. Never round
    // real decimals, parse scientific notation or remove leading zeros.
    const cleaned=compact.replace(/^(\d{3,15})\.0+$/, '$1');
    if(!/^\d{3,15}$/.test(cleaned)){if(invalid.length<8)invalid.push({row:i+1,value:raw.slice(0,35)});continue;}
    if(seen.has(cleaned))continue;
    seen.add(cleaned);candidates.push({n_predio:cleaned,row:i+1});
  }
  return {candidates,warnings:invalid.length?[invalid.length+' filas con valores no válidos fueron omitidas; revisa la columna y el encabezado.']:[]};
}
