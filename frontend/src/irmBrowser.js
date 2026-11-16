import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const patterns = {
  predio: /datos\s*del\s*predio[\s\S]{0,250}?n[uú]mero\s*:?\s*(\d{3,15})/i,
  lote_minimo: /lote\s*m[ií]nimo\s*:?\s*([\d.,]+)\s*m2/i,
  frente_minimo: /frente\s*m[ií]nimo\s*:?\s*([\d.,]+)\s*m/i,
  cos_pb: /cos\s*pb\s*:?\s*([\d.,]+)\s*%/i,
  cos_total: /cos\s*total\s*:?\s*([\d.,]+)\s*%/i,
  pisos: /n[uú]mero\s*de\s*pisos\s*:?\s*(\d+)/i,
  area_terreno: /[aá]rea\s*(?:seg[uú]n\s*escritura|del\s*terreno)\s*:?\s*([\d.,]+)\s*m2/i,
};
const evidenceTypes = [
  {key:'quebrada', rx:/quebrada\s*abierta|protecci[oó]n\s*de\s*quebrada|zona\s*de\s*protecci[oó]n\s*de\s*quebrada/i, title:'Quebrada y franja de protección', mapPages:[7], finding:'El IRM menciona una quebrada y su protección. Verifique las restricciones y la definición municipal del borde antes de construir.'},
  {key:'forestal', rx:/bosque\s*protector|protecci[oó]n\s*forestal|cobertura\s*forestal/i, title:'Protección forestal', mapPages:[9], finding:'El documento menciona protección forestal; confirme el polígono y la norma aplicable.'},
  {key:'fallas', rx:/falla\s*geol[oó]gica|falla\s*tect[oó]nica/i, title:'Falla geológica', mapPages:[7], finding:'Se menciona una falla geológica; solicite verificación técnica de la ubicación y afectación.'},
  {key:'proteccion', rx:/protecci[oó]n\s*ecol[oó]gica/i, title:'Zona de protección ecológica', mapPages:[6], finding:'El IRM contiene una designación de protección ecológica, que puede afectar una parte del lote matriz.'},
];

async function renderEvidencePage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({scale:1.35});
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  return canvas.toDataURL('image/jpeg',0.82);
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
      const page=type.mapPages.find(n=>n<=pdf.numPages);
      evidence.push({key:type.key,title:type.title,finding:type.finding,sourcePages:matches,
        imagePage:page||null,
        image:page?await renderEvidencePage(pdf,page):null,
        note:'Mapa del IRM para revisión visual; la delimitación exacta requiere verificación municipal.'});
    }
    return {filename:file.name,pages:pdf.numPages,candidate_irm_fields:fields,evidence,
      warnings:[],stored:false,verified:false,regulatory_eligibility:'pending_review'};
  } finally {await pdf.destroy();}
}
