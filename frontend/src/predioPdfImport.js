// Conservative local extraction of clearly labeled Quito predio identifiers.
// No network request, OCR, identity, address or ownership extraction.
const ID = '(\\d{3,15})';
const labeled = new RegExp('(?:n(?:[úu]mero|[º°o.]*)\\s*(?:de\\s*)?(?:predio|predial)|n[_\\s-]*predio|predio\\s*(?:n[º°uú]mero|n[º°.]|#)?|predial\\s*n[º°.]?)\\s*[:#–-]?\\s*' + ID + '(?!\\d)', 'gi');
const keyPattern = /(?:clave\s*catastral|clave\s*cata|c[oó]digo\s*catastral)\s*[:#–-]?\s*([\d-]{8,30})/i;

export function extractPredioCandidatesFromPages(pages) {
  const found = new Map();
  const warnings = [];
  for (const { page, lines } of pages) {
    let tableMode = false;
    for (const original of lines) {
      const line = String(original || '').replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if (/^(?:n(?:[úu]mero|[º°o.]*)\s*(?:de\s*)?predio|n[_\s-]*predio)\b/i.test(line) && !/\d{3,15}/.test(line)) {
        tableMode = true; continue;
      }
      const ids = [];
      labeled.lastIndex = 0;
      let match;
      while ((match = labeled.exec(line))) ids.push(match[1]);
      // Table-like exports: after an explicit header, accept an ID only if
      // the row begins with it, never a stray unrelated number in running text.
      if (!ids.length && tableMode) {
        const rowMatch = line.match(/^(\d{3,15})(?:\s+|$)/);
        if (rowMatch) ids.push(rowMatch[1]);
        else if (/^(?:total|observaci[oó]n|resumen|firma|fecha)\b/i.test(line)) tableMode = false;
      }
      if (!ids.length) continue;
      const key = ids.length === 1 ? line.match(keyPattern)?.[1]?.replace(/-/g, '') || '' : '';
      for (const id of ids) {
        if (found.has(id)) continue;
        found.set(id, { n_predio: id, clave_cata: key, page, evidence: line.slice(0, 220) });
      }
    }
  }
  if (!found.size) warnings.push('No se encontró un número de predio explícito en el texto del PDF.');
  return { candidates: [...found.values()], warnings };
}

export async function extractPredioCandidatesFromPdf(file) {
  if (!file || (file.type && file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf'))) throw new Error('Selecciona un archivo PDF.');
  if (file.size > 15 * 1024 * 1024) throw new Error('El PDF supera el límite de 15 MB.');
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({ data: bytes }).promise;
  try {
    if (document.numPages > 100) throw new Error('Este importador admite hasta 100 páginas.');
    const pages = [];
    for (let n = 1; n <= document.numPages; n++) {
      const p = await document.getPage(n);
      const text = await p.getTextContent();
      const rows = new Map();
      for (const item of text.items) {
        if (!item.str?.trim() || !item.transform) continue;
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: item.transform[4], str: item.str });
      }
      const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) =>
        items.sort((a, b) => a.x - b.x).map(i => i.str).join(' '));
      pages.push({ page: n, lines });
    }
    const result = extractPredioCandidatesFromPages(pages);
    if (!pages.some(p => p.lines.length)) result.warnings.push('El documento parece escaneado: no se detectó texto seleccionable. Se requiere OCR o una lista editable.');
    return result;
  } finally { await document.destroy(); }
}
