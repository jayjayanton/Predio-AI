import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const patterns = {
  predio: /datos\s*del\s*predio[\s\S]{0,250}?n[uú]mero\s*:?\s*(\d{3,15})/i,
  codigo_municipal_edificabilidad: /c[oó]digo\s*(?:de\s*)?edificabilidad\s*:?\s*(A\d{1,4})/i,
  codigo_edificabilidad_basica: /c[oó]digo\s*(?:de\s*)?edificabilidad\s*:?\s*A\d{1,4}\s*\(\s*([A-Z]\d{3,6}-\d{1,3})\s*\)/i,
  lote_minimo: /lote\s*m[ií]nimo\s*:?\s*([\d.,]+)\s*m2/i,
  frente_minimo: /frente\s*m[ií]nimo\s*:?\s*([\d.,]+)\s*m/i,
  cos_pb: /cos\s*pb\s*:?\s*([\d.,]+)\s*%/i,
  cos_total: /cos\s*total\s*:?\s*([\d.,]+)\s*%/i,
  pisos: /n[uú]mero\s*de\s*pisos\s*:?\s*(\d+)/i,
  area_terreno: /[aá]rea\s*(?:seg[uú]n\s*escritura|del\s*terreno)\s*:?\s*([\d.,]+)\s*m2/i,
};
const evidenceTypes = [
  {key:'quebrada', rx:/quebrada\\s*abierta|protecci[oó]n\\s*de\\s*quebrada|zona\\s*de\\s*protecci[oó]n\\s*de\\s*quebrada/i,
   title:'Quebrada y protección geográfica', mapHeading:'ACCIDENTES GEOGRÁFICOS',
   finding:'El IRM identifica una quebrada y una franja de protección. El mapa muestra la ubicación referencial de los accidentes geográficos respecto del lote resaltado; el borde y retiro definitivo requieren definición municipal.'},
  {key:'forestal', rx:/bosque\\s*protector|protecci[oó]n\\s*forestal|cobertura\\s*forestal/i,
   title:'Protección forestal', mapHeading:'SISTEMA NACIONAL DE ÁREAS PROTEGIDAS',
   finding:'El documento menciona protección forestal. El mapa representa áreas protegidas en el entorno, pero no acredita por sí solo cobertura forestal dentro del predio.'},
  {key:'fallas', rx:/falla\\s*geol[oó]gica|falla\\s*tect[oó]nica/i,
   title:'Falla geológica', mapHeading:'ACCIDENTES GEOGRÁFICOS',
   finding:'El documento menciona una falla. El mapa de accidentes geográficos es contextual y no delimita necesariamente una falla tectónica; requiere estudio técnico.'},
  {key:'proteccion', rx:/protecci[oó]n\\s*ecol[oó]gica/i,
   title:'Protección ecológica', mapHeading:'USO DE SUELO ESPECÍFICO',
   finding:'El IRM identifica una designación de protección ecológica. El mapa de uso de suelo específico muestra las zonas de uso en torno al lote; debe contrastarse con los polígonos oficiales para determinar la superficie afectada.'},
];

const normalizeHeading = value => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().replace(/\\s+/g, ' ').trim();

// Layout-based computer vision: locate the map heading in the PDF text layer,
// then crop the square cartographic panel rather than screenshotting the full page.
// Handles maps continued at the beginning of the following printed page.
async function extractMapRegion(pdf, heading) {
  const target = normalizeHeading(heading);
  for (let pageNo=1;pageNo<=pdf.numPages;pageNo++) {
    const page=await pdf.getPage(pageNo);
    const content=await page.getTextContent();
    // Headings are often split across multiple PDF text spans.
    const items=content.items.filter(item=>String(item.str || '').trim());
    const match=items.find((item,index)=>normalizeHeading(items.slice(index,index+5).map(x=>x.str).join(' ')).includes(target));
    if (!match) continue;
    const headingY=page.view[3] - match.transform[5];
    let mapPage=page;
    let mapPageNo=pageNo;
    let mapTop=headingY + 12;
    if (mapTop + 205 > page.view[3] - 45) {
      if (pageNo === pdf.numPages) return null;
      mapPage=await pdf.getPage(pageNo+1);
      mapPageNo=pageNo+1;
      mapTop=40;
    }
    const scale=2;
    const viewport=mapPage.getViewport({scale});
    const rendered=document.createElement('canvas');
    rendered.width=Math.round(viewport.width);
    rendered.height=Math.round(viewport.height);
    await mapPage.render({canvasContext:rendered.getContext('2d'),viewport}).promise;
    const size=Math.min(205,mapPage.view[2]-30);
    const x=(mapPage.view[2]-size)/2;
    const crop=document.createElement('canvas');
    crop.width=Math.round(size*scale);
    crop.height=Math.round(size*scale);
    crop.getContext('2d').drawImage(rendered,
      Math.round(x*scale),Math.round(mapTop*scale),crop.width,crop.height,
      0,0,crop.width,crop.height);
    return {image:crop.toDataURL('image/png'),imagePage:mapPageNo};
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
    // Restriction evidence is text-based; maps are illustrative, not georeferenced proof.
    const evidence=[];
    for (const type of evidenceTypes) {
      const matches=pageTexts.flatMap((value,i)=>type.rx.test(value)?[i+1]:[]);
      if (!matches.length) continue;
      const map=await extractMapRegion(pdf,type.mapHeading);
      evidence.push({key:type.key,title:type.title,finding:type.finding,sourcePages:matches,
        imagePage:map?.imagePage || null,
        image:map?.image || null,
        mapDescription:type.finding,
        note:map ? 'Recorte cartográfico extraído del PDF mediante detección de encabezados y segmentación de región. La delimitación exacta requiere verificación municipal.' : 'El IRM contiene la referencia textual, pero no se encontró un mapa identificable para recortar.'});
    }
    return {filename:file.name,pages:pdf.numPages,candidate_irm_fields:fields,evidence,
      warnings:[],stored:false,verified:false,regulatory_eligibility:'pending_review'};
  } finally {await pdf.destroy();}
}
