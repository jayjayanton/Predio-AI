import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const patterns = {
  predio: /datos\s*del\s*predio[\s\S]{0,250}?n[uú]mero\s*:?\s*(\d{3,15})/i,
  codigo_municipal_edificabilidad: /c[oó]digo\s*(?:de\s*)?edificabilidad\s*:?\s*(A\d{1,4})/i,
  codigo_edificabilidad_basica: /c[oó]digo\s*(?:de\s*)?edificabilidad\s*:?\s*A\d{1,4}\s*\(\s*([A-Z]\d{3,6}-\d{1,3}(?:\s*\([A-Z0-9-]+\))?)\s*\)/i,
  avaluo_terreno: /aval[uú]o\s*del\s*terreno\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_cubiertas: /aval[uú]o\s*de\s*construcciones\s*cubiertas\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_abiertas: /aval[uú]o\s*de\s*construcciones\s*abiertas\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_instalaciones: /aval[uú]o\s*de\s*instalaciones\s*especiales\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_comunales_cubiertas: /aval[uú]o\s*de\s*construcciones\s*comunales\s*cubiertas\s*proporcional\s*a\s*la\s*al[ií]cuota\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_comunales_abiertas: /aval[uú]o\s*de\s*construcciones\s*comunales\s*abiertas\s*proporcional\s*a\s*la\s*al[ií]cuota\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_adicionales: /aval[uú]o\s*de\s*adicionales\s*constructivos\s*proporcional\s*a\s*la\s*al[ií]cuota\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_comunal_especial: /aval[uú]o\s*comunal\s*especial\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  avaluo_total_certificado: /aval[uú]o\s*total\s*del\s*bien\s*inmueble\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
  lote_minimo: /lote\s*m[ií]nimo\s*:?\s*([\d.,]+)\s*m2/i,
  frente_minimo: /frente\s*m[ií]nimo\s*:?\s*([\d.,]+)\s*m/i,
  cos_pb: /cos\s*pb\s*:?\s*([\d.,]+)\s*%/i,
  cos_total: /cos\s*total\s*:?\s*([\d.,]+)\s*%/i,
  pisos: /n[uú]mero\s*de\s*pisos\s*:?\s*(\d+)/i,
  area_terreno: /[aá]rea\s*(?:seg[uú]n\s*escritura|del\s*terreno)\s*:?\s*([\d.,]+)\s*m2/i,
};
// Read PUGS parameters from the IRM's own APROVECHAMIENTO URBANÍSTICO section,
// rather than matching identically named labels elsewhere in the document.
const pugsPatterns = {
  clasificacion_suelo: /clasificaci[oó]n\s*:?\s*(?:\(\s*([A-Z]{1,4})\s*\)\s*)?([^:;\n]{4,55}?)(?=\s+subclasificaci[oó]n\s*:|$)/i,
  subclasificacion_suelo: /subclasificaci[oó]n\s*:?\s*([^:;\n]{3,65}?)(?=\s+(?:componente|uso\s+suelo|tratamiento|PIT)\s*:|$)/i,
  uso_suelo_general: /uso\s+(?:de\s+)?suelo\s+general\s*:?\s*(?:\(\s*([A-Z]+)\s*\)\s*)?([^:;\n]{3,65}?)(?=\s+uso\s+(?:de\s+)?suelo\s+espec[ií]fico\s*:|$)/i,
  uso_suelo_especifico: /uso\s+(?:de\s+)?suelo\s+espec[ií]fico\s*:?\s*(?:\(\s*([A-Z]+)\s*\)\s*)?([^:;\n]{3,65}?)(?=\s+tratamiento\s*:|$)/i,
  tratamiento: /tratamiento\s*:?\s*([^:;\n]{3,60}?)(?=\s+PIT\s*:|$)/i,
  pit: /\bPIT\s*:?\s*([A-Z0-9-]{5,30})/i,
  forma_ocupacion: /forma\s+de\s+ocupaci[oó]n\s*:?\s*(?:\(\s*[A-Z]\s*\)\s*)?([^:;\n]{3,45}?)(?=\s+retiro\s+frontal\s*:|$)/i,
  retiro_frontal: /retiro\s+frontal\s*:?\s*([\d.,]+)\s*m\b/i,
  retiro_lateral: /retiro\s+lateral\s*:?\s*([\d.,]+)\s*m\b/i,
  retiro_posterior: /retiro\s+posterior\s*:?\s*([\d.,]+)\s*m\b/i,
  entre_bloques: /entre\s+bloques\s*:?\s*([\d.,]+)\s*m\b/i,
  altura_pisos: /altura\s+de\s+pisos\s*:?\s*([\d.,]+)\s*m\b/i,
  servicios_basicos: /factibilidad\s+de\s+servicios\s+b[aá]sicos\s*:?\s*(S[IÍ]|NO)/i,
};
const pugsNumberKeys = new Set(['retiro_frontal','retiro_lateral','retiro_posterior','entre_bloques','altura_pisos']);
function extractPugsSection(pageTexts) {
  const startRx = /APROVECHAMIENTO\s+URBAN[IÍ]STICO\s*\(\s*PUGS\s*\)/i;
  const stopRx = /(?:AFECTACIONES\s+(?:ESPECIALES|VIALES)|OBSERVACIONES\s+GENERALES|NOTAS\s+IMPORTANTES|DATOS\s+DEL\s+PREDIO)/i;
  const startPage = pageTexts.findIndex(value => startRx.test(value));
  if (startPage < 0) return {};
  // Include continuation onto next page but do not scan unrelated sections.
  const joined = pageTexts.slice(startPage, Math.min(pageTexts.length,startPage+3)).join(' ');
  const start = joined.search(startRx);
  const body = joined.slice(start).replace(startRx,'');
  const stop = body.search(stopRx);
  const section = (stop >= 0 ? body.slice(0,stop) : body).slice(0,6500);
  const result = {};
  for (const [key,rx] of Object.entries(pugsPatterns)) {
    const match=section.match(rx);
    if (match) {
      const raw=(match[2] || match[1] || '').trim();
      if (raw) result[key]={raw,status:'unverified_extraction'};
    }
  }
  return result;
}

// Extract ALL PUGS assignments. A single IRM may contain residential and PE
// sections with different buildability rules; never collapse to the first one.
function extractPugsAssignments(pageTexts) {
  const joined=pageTexts.join('\n');
  const start=joined.search(/APROVECHAMIENTO\s+URBAN[IÍ]STICO\s*\(\s*PUGS\s*\)/i);
  if(start<0)return [];
  const after=joined.slice(start);
  const stop=after.search(/ORDENANZA\s+ANTERIOR|AFECTACIONES\s*\/\s*PROTECCIONES/i);
  const body=stop>=0?after.slice(0,stop):after;
  const blocks=body.split(/COMPONENTE\s+ESTRUCTURANTE/i).slice(1);
  return blocks.map((block,index)=>{
    const take=rx=>block.match(rx)?.[1]?.trim()||null;
    const specific=block.match(/uso\s+(?:de\s+)?suelo\s+espec[ií]fico\s*:?\s*\(\s*([A-Z][A-Z0-9-]*)\s*\)\s*([\s\S]{0,100}?)(?=\s+(?:tratamiento|PIT|EDIFICABILIDAD|COMPONENTE)\b|$)/i);
    const code= specific?.[1] || null;
    if(!code)return null;
    const description=(specific?.[2]||'').replace(/\s+/g,' ').trim();
    const general=block.match(/uso\s+(?:de\s+)?suelo\s+general\s*:?\s*\(\s*([A-Z]+)\s*\)\s*([\s\S]{0,100}?)(?=\s+uso\s+(?:de\s+)?suelo\s+espec[ií]fico\b|$)/i);
    const basic=block.match(/c[oó]digo\s+edificabilidad\s*:?\s*(A\d{1,4})\s*\(\s*([A-Z]\d{3,6}-\d{1,3}(?:\s*\([A-Z0-9-]+\))?|PQ)\s*\)/i);
    return {
      index:index+1, code, description,
      classification:take(/clasificaci[oó]n\s*:?\s*\(\s*([A-Z]{1,4})\s*\)/i),
      generalUse:general?.[1] || null,
      generalDescription:general?.[2]?.replace(/\s+/g,' ').trim() || null,
      treatment:take(/tratamiento\s*:?\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{3,45}?)(?=\s+PIT\s*:|$)/i),
      pit:take(/\bPIT\s*:?\s*([A-Z]{1,4}-PIT[A-Z0-9]+)/i),
      buildability:basic?basic[1]+' ('+basic[2].trim()+')':null,
      isProtection:code==='PE'||/protecci[oó]n ecol[oó]gica/i.test(description)
    };
  }).filter(Boolean);
}

const evidenceTypes = [
  {key:'quebrada', rx:/quebrada\s*abierta|protecci[oó]n\s*de\s*quebrada|zona\s*de\s*protecci[oó]n\s*de\s*quebrada/i,
   title:'Quebrada y protección geográfica', mapHeading:'ACCIDENTES GEOGRÁFICOS',
   finding:'Afectación identificada: QUEBRADA ABIERTA y protección de accidente geográfico. El IRM prohíbe edificar dentro de la quebrada abierta y señala que el retiro mostrado es referencial. Para edificar se requiere definición municipal del borde superior y del retiro definitivo.'},
  {key:'forestal', rx:/bosque\s*protector|protecci[oó]n\s*forestal|cobertura\s*forestal/i,
   title:'Protección forestal', mapHeading:'SISTEMA NACIONAL DE ÁREAS PROTEGIDAS',
   finding:'Afectación potencial: protección forestal mencionada en el IRM. El mapa del Sistema Nacional de Áreas Protegidas aporta contexto; por sí solo no prueba que el predio esté dentro de un bosque protector.'},
  {key:'fallas', rx:/falla\s*geol[oó]gica|falla\s*tect[oó]nica/i,
   title:'Falla geológica', mapHeading:'ACCIDENTES GEOGRÁFICOS',
   finding:'Afectación potencial: falla geológica mencionada en el IRM. El mapa de accidentes geográficos no demuestra por sí solo la ubicación de una falla; debe verificarse con información geológica específica.'},
  {key:'proteccion', rx:/protecci[oó]n\s*ecol[oó]gica/i,
   title:'Protección ecológica', mapHeading:'USO DE SUELO ESPECÍFICO',
   finding:'Afectación identificada en el texto del IRM: una segunda asignación PUGS de Protección Ecológica (PE), código A120 (PQ), sin parámetros de edificabilidad residencial. Este recorte de USO DE SUELO ESPECÍFICO muestra principalmente RUB-2; no demuestra por sí solo la ubicación ni extensión de PE. Se requiere contrastar el mapa y los polígonos oficiales antes de atribuir superficies afectadas.'},
];

const normalizeHeading = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Layout-based computer vision: locate the map heading in the PDF text layer,
// then crop the square cartographic panel rather than screenshotting the full page.
// Handles maps continued at the beginning of the following printed page.
// Municipal PDF uses two map columns. Crop the correct column, not the
// page center (which previously produced two half-maps and a white strip).
async function cropPdfRegion(page, x, top, width, height) {
  const scale=2;
  const viewport=page.getViewport({scale});
  const rendered=document.createElement('canvas');
  rendered.width=Math.round(viewport.width);
  rendered.height=Math.round(viewport.height);
  await page.render({canvasContext:rendered.getContext('2d'),viewport}).promise;
  const crop=document.createElement('canvas');
  crop.width=Math.round(width*scale);
  crop.height=Math.round(height*scale);
  crop.getContext('2d').drawImage(rendered,
    Math.round(x*scale),Math.round(top*scale),crop.width,crop.height,
    0,0,crop.width,crop.height);
  return crop;
}

function findHeadingPosition(items, heading) {
  const target=normalizeHeading(heading);
  const first=target.split(' ')[0];
  for(let i=0;i<items.length;i++){
    const current=normalizeHeading(items[i].str);
    if(!current.startsWith(first)) continue;
    const y=items[i].transform[5];
    const x=items[i].transform[4];
    const sameLine=items.slice(i,i+7)
      .filter(item=>Math.abs(item.transform[5]-y)<4 &&
        Math.abs(item.transform[4]-x)<260)
      .map(item=>item.str).join(' ');
    if(normalizeHeading(sameLine).startsWith(target)) return items[i];
  }
  return null;
}

async function extractMapRegion(pdf, heading) {
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo);
    const items=(await page.getTextContent()).items.filter(item=>String(item.str||'').trim());
    const match=findHeadingPosition(items,heading);
    if(!match) continue;
    const pageWidth=page.view[2],pageHeight=page.view[3];
    const left=match.transform[4]<pageWidth/2;
    // Map panels are square, each inside its own column.
    const size=pageWidth*0.315;
    const x=pageWidth*(left?0.103:0.583);
    const headingBaseline=pageHeight-match.transform[5];
    let mapPage=page,mapPageNo=pageNo,top=headingBaseline+4;
    if(top+size>pageHeight-18){
      if(pageNo===pdf.numPages)return null;
      mapPage=await pdf.getPage(pageNo+1);
      mapPageNo=pageNo+1;
      top=18;
    }
    const canvas=await cropPdfRegion(mapPage,x,top,size,size);
    return {image:canvas.toDataURL('image/png'),imagePage:mapPageNo,
      // The map heading defines the document reading order even when the
      // graphic itself continues onto the following PDF page.
      imageOrder: pageNo*1000000 + headingBaseline*1000 + match.transform[4]};
  }
  return null;
}

// Detect the orange building footprint within the right-column diagram.
// This avoids confusing the colored PUGS table or a blank field with a diagram.
function hasOccupationDiagram(canvas){
  const {data}=canvas.getContext('2d',{willReadFrequently:true})
    .getImageData(0,0,canvas.width,canvas.height);
  let orange=0;
  for(let i=0;i<data.length;i+=16){
    const red=data[i],green=data[i+1],blue=data[i+2];
    if(red>155 && green>65 && green<190 && blue<125 && red>green+30) orange++;
  }
  return orange>120;
}

async function extractOccupationDiagram(pdf){
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo);
    const items=(await page.getTextContent()).items.filter(item=>String(item.str||'').trim());
    const match=findHeadingPosition(items,'EDIFICABILIDAD GENERAL MÁXIMA');
    if(!match)continue;
    const w=page.view[2],h=page.view[3],size=w*0.315,x=w*0.573;
    const baseline=h-match.transform[5];
    // In this IRM template, the diagram sits after the right-column
    // maximum-buildability fields, frequently on the following PDF page.
    const candidates=[
      {page,number:pageNo,top:baseline+120},
      {page,number:pageNo,top:baseline+155}
    ];
    if(pageNo<pdf.numPages){
      const next=await pdf.getPage(pageNo+1);
      candidates.push({page:next,number:pageNo+1,top:18});
    }
    for(const candidate of candidates){
      if(candidate.top<0 || candidate.top+size>candidate.page.view[3]-10)continue;
      const canvas=await cropPdfRegion(candidate.page,x,candidate.top,size,size);
      if(!hasOccupationDiagram(canvas))continue;
      return {image:canvas.toDataURL('image/png'),imagePage:candidate.number,
        imageOrder:candidate.number*1000000 + candidate.top*1000 + x,
        title:'Esquema de implantación y retiros',
        note:'Esquema municipal de ocupación y retiros. No representa un plano aprobado ni concede derechos constructivos adicionales.'};
    }
  }
  return null;
}

export async function inspectIrmInBrowser(file) {
  if (!file || !/\.pdf$/i.test(file.name)) throw new Error('Seleccione un PDF válido.');
  if (file.size > 15 * 1024 * 1024) throw new Error('El PDF supera 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-') throw new Error('El archivo no es un PDF válido.');
  const pdf = await pdfjs.getDocument({data:bytes}).promise;
  try {
    if (pdf.numPages > 100) throw new Error('El documento supera 100 páginas.');
    const pageTexts = [];
    for (let i=1;i<=pdf.numPages;i++) {
      const page=await pdf.getPage(i);
      const content=await page.getTextContent();
      pageTexts.push(content.items.map(item=>item.str||'').join(' ').replace(/\s+/g,' '));
    }
    const text=pageTexts.join('\n');
    const fields={};
    for (const [key,rx] of Object.entries(patterns)) {
      const match=text.match(rx);
      if (match) fields[key]={raw:match[1],status:'unverified_extraction'};
    }
    Object.assign(fields, extractPugsSection(pageTexts));
    const pugsAssignments=extractPugsAssignments(pageTexts);
    // Fallback for PDFs whose text layer splits PUGS table cells differently.
    // A single-zone IRM must still expose its specific use, not disappear.
    if (!pugsAssignments.length) {
      const pugsText=pageTexts.slice(Math.max(0,pageTexts.findIndex(page =>
        /APROVECHAMIENTO\s+URBAN[IÍ]STICO\s*\(\s*PUGS\s*\)/i.test(page)))).join(' ');
      const specific=pugsText.match(/uso\s+(?:de\s+)?suelo\s+espec[ií]fico\s*:?\s*\(\s*([A-Z][A-Z0-9-]*)\s*\)\s*([^:]{2,70}?)(?=\s+(?:tratamiento|PIT|EDIFICABILIDAD|COMPONENTE)\b|$)/i);
      if (specific) {
        const general=pugsText.match(/uso\s+(?:de\s+)?suelo\s+general\s*:?\s*\(\s*([A-Z]+)\s*\)\s*([^:]{2,70}?)(?=\s+uso\s+(?:de\s+)?suelo\s+espec[ií]fico\b|$)/i);
        pugsAssignments.push({index:1,code:specific[1],description:specific[2].trim(),
          generalUse:general?.[1] || null,generalDescription:general?.[2]?.trim() || null,
          classification:fields.clasificacion_suelo?.raw || null,
          pit:fields.pit?.raw || null,
          buildability:fields.codigo_municipal_edificabilidad?.raw || null,
          isProtection:specific[1]==='PE'});
      }
    }
    // Restriction evidence is text-based; maps are illustrative, not georeferenced proof.
    const evidence=[];
    for (const type of evidenceTypes) {
      const matches=pageTexts.flatMap((value,i)=>type.rx.test(value)?[i+1]:[]);
      if (!matches.length) continue;
      const map=await extractMapRegion(pdf,type.mapHeading);
      evidence.push({key:type.key,title:type.title,finding:type.finding,sourcePages:matches,
        imagePage:map?.imagePage || null,
        imageOrder:map?.imageOrder ?? null,
        image:map?.image || null,
        mapDescription:type.finding,
        note:map ? 'Recorte cartográfico extraído del PDF mediante detección de encabezados y segmentación de región. La delimitación exacta requiere verificación municipal.' : 'El IRM contiene la referencia textual, pero no se encontró un mapa identificable para recortar.'});
    }
    // Preserve source-PDF reading order (page, then row, then column),
    // not the order of restriction categories in evidenceTypes.
    evidence.sort((a,b) => (a.imageOrder ?? Number.MAX_SAFE_INTEGER) - (b.imageOrder ?? Number.MAX_SAFE_INTEGER));
    const occupationDiagram=await extractOccupationDiagram(pdf);
    return {filename:file.name,pages:pdf.numPages,candidate_irm_fields:fields,evidence,occupationDiagram,pugsAssignments,
      warnings:[],stored:false,verified:false,regulatory_eligibility:'pending_review'};
  } finally {await pdf.destroy();}
}
