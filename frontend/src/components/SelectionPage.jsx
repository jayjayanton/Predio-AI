import React, { useMemo, useState } from 'react';
import { COMPARISON_LIMIT, SELECTION_LIMIT, selectionCSV } from '../selection.js';
import { extractPredioCandidatesFromPdf } from '../predioPdfImport.js';
import { readTabularFile, suggestedHeader, candidatesFromColumn } from '../tabularImport.js';
import '../styles/portfolio.css';

const displayNumber = (value, suffix = '') => value == null || !Number.isFinite(Number(value)) ? 'Pendiente de consulta' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 }) + suffix;
const isPH = p => (p.tipo_propi || '').trim().toUpperCase() === 'PROPIEDAD HORIZONTAL';

export default function SelectionPage({ records, onExplore, onOpen, onRemove, onImport, onIrmReview, onEnrich, loading, error, storageAvailable }) {
  const [comparison, setComparison] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [fileName, setFileName] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [importing, setImporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState('');
  const [enrichResult, setEnrichResult] = useState('');
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [tabular, setTabular] = useState([]);
  const [tabularSheet, setTabularSheet] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [predioColumn, setPredioColumn] = useState(0);
  const [tabularName, setTabularName] = useState('');
  const [paste, setPaste] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const visible = useMemo(() => records.filter(p =>
    (statusFilter === 'all' || (statusFilter === 'pending' ? p.irmReview !== 'manual_reviewed' : p.irmReview === 'manual_reviewed')) &&
    (!search || [p.n_predio, p.clave_cata, p.parroquia].some(field => String(field || '').toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))))
  ), [records, search, statusFilter]);
  const compareRecords = useMemo(() => comparison.map(id => records.find(p => p.n_predio === id)).filter(Boolean), [comparison, records]);
  const rows = [
    ['Parroquia', p => p.parroquia || 'Por consultar'],
    ['Régimen', p => p.tipo_propi || 'Por consultar'],
    ['Lote / lote matriz', p => displayNumber(p.area_terre, ' m²')],
    ['Terreno atribuido PH', p => isPH(p) ? displayNumber(p.area_ter_1, ' m²') : 'No aplica'],
    ['Construcción registrada', p => displayNumber(p.area_const, ' m²')],
    ['Frente registrado', p => displayNumber(p.frente, ' m')],
    ['Clasificación del suelo', p => p.zonificaci || 'Por consultar'],
    ['Clave catastral', p => p.clave_cata || 'Por consultar'],
  ];

  function exportCSV() {
    const url = URL.createObjectURL(new Blob([selectionCSV(records)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'PredioAI-cartera-predios.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reviewCandidates(found, label, notes = []) {
    const seen = new Set();
    const clean = found.filter(item => /^\d{3,15}$/.test(String(item.n_predio)) && !seen.has(item.n_predio) && seen.add(item.n_predio)).slice(0, 200);
    setCandidates(clean);
    setChosen(clean.map(p => p.n_predio).filter(id => !records.some(p => p.n_predio === id)));
    setWarnings(notes);
    setFileName(label);
    setImportError('');
    setImportMessage('');
  }

  async function handlePdf(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setImportMessage('');
    setImporting(true);
    try {
      const result = await extractPredioCandidatesFromPdf(file);
      reviewCandidates(result.candidates, file.name, result.warnings);
    } catch (ex) {
      setCandidates([]); setChosen([]); setFileName('');
      setImportError(ex?.message || 'No se pudo leer el PDF.');
    } finally { setImporting(false); }
  }

  function configureTable(sheets, sheetIndex) {
    const sheet=sheets[sheetIndex];
    const hint=suggestedHeader(sheet.rows);
    setTabularSheet(sheetIndex);setHeaderRow(hint.row);setPredioColumn(hint.col);
    setCandidates([]);setChosen([]);setImportError('');setImportMessage('');
  }
  async function handleTable(event) {
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    setImporting(true);setImportError('');setCandidates([]);setChosen([]);
    try {
      const sheets=await readTabularFile(file);
      setTabular(sheets);setTabularName(file.name);configureTable(sheets,0);
    } catch(error) {
      setTabular([]);setTabularName('');
      setImportError(error?.message||'No se pudo leer el archivo.');
    } finally {setImporting(false);}
  }
  function previewColumn() {
    const sheet=tabular[tabularSheet];
    if(!sheet)return;
    const result=candidatesFromColumn(sheet.rows,headerRow,predioColumn);
    if(!result.candidates.length){
      setImportError('No se detectaron predios válidos en esta columna. Revisa la fila de encabezados y la columna elegida.');
      return;
    }
    reviewCandidates(result.candidates,tabularName+' · '+sheet.name,result.warnings);
  }

  function handlePaste() {
    const lines = paste.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean);
    const found = lines.map(t => ({ n_predio: t.match(/^(?:predio\s*[:#-]?\s*)?(\d{3,15})$/i)?.[1] || '' })).filter(t => t.n_predio);
    if (!found.length) { setImportError('Introduce un número de predio por línea.'); return; }
    reviewCandidates(found, 'Lista escrita', []);
  }

  function importApproved() {
    const items = candidates.filter(p => chosen.includes(p.n_predio))
      .map(p => ({ n_predio: p.n_predio, clave_cata: p.clave_cata || '', source: 'pdf' }));
    if (!items.length) { setImportError('Selecciona al menos un predio para agregar.'); return; }
    const result = onImport(items);
    setImportMessage(`${result.added} agregados · ${result.duplicates} repetidos · ${result.full} sin espacio · ${result.rejected} inválidos.`);
    setCandidates([]); setChosen([]); setWarnings([]); setFileName(''); setTabular([]); setTabularName('');
  }

  async function fillMunicipalData() {
    const ids = records.filter(p => p.source === 'pdf').slice(0, 10).map(p => p.n_predio);
    if (!ids.length || enriching) return;
    setEnriching(true); setEnrichResult(''); setEnrichProgress('');
    try {
      const result = await onEnrich(ids, setEnrichProgress);
      setEnrichResult(`${result.updated} fichas completadas con datos municipales; ${result.failed} sin confirmar. Puedes reintentar las pendientes.`);
    } catch (error) {
      setEnrichResult('No se pudieron completar las consultas. Los datos existentes siguen guardados.');
    } finally { setEnriching(false); setEnrichProgress(''); }
  }

  function toggleCompare(id, checked) {
    setComparison(old => checked ? (old.includes(id) || old.length >= COMPARISON_LIMIT ? old : [...old, id]) : old.filter(x => x !== id));
  }
  const selectedExisting = candidates.filter(item => records.some(p => p.n_predio === item.n_predio)).length;
  const remaining = SELECTION_LIMIT - records.length;
  return <section className="portfolio-page selection-portfolio" aria-labelledby="selection-title">
    <div className="workspace-heading">
      <div><span className="eyebrow">CARTERA DE PROYECTOS</span><h1 id="selection-title">Tus predios, en un solo lugar.</h1><p>Reúne hasta {SELECTION_LIMIT} predios para gestionarlos uno por uno. Compara hasta {COMPARISON_LIMIT} a la vez y consulta el IRM individualmente.</p></div>
      <button type="button" className="secondary" onClick={onExplore}>Explorar mapa ↗</button>
    </div>
    <div className="selection-toolbar"><span>{records.length} de {SELECTION_LIMIT} predios · {storageAvailable ? 'Identificadores guardados en este navegador' : 'Solo durante esta sesión'}</span><div className="portfolio-toolbar-actions">{records.some(p => p.source === 'pdf') && <button type="button" className="secondary" onClick={fillMunicipalData} disabled={enriching} aria-busy={enriching}>{enriching ? 'Consultando…' : 'Completar datos municipales · hasta 10'}</button>}{records.length > 0 && <button type="button" className="secondary" onClick={exportCSV}>Exportar cartera CSV ↓</button>}</div></div>
    {enrichProgress && <p role="status" className="portfolio-notice">{enrichProgress}</p>}
    {enrichResult && <p role="status" className="portfolio-notice">{enrichResult}</p>}
    <p className="portfolio-scope">No es una base de proyectos compartida: no se conservan los PDF, el texto extraído ni los IRM. Cada predio se abre para consultar la ficha municipal y cargar/revisar su IRM de forma independiente.</p>

    <section className="portfolio-import" aria-labelledby="portfolio-import-title">
      <div><span className="eyebrow">IMPORTAR EN LOTE</span><h2 id="portfolio-import-title">Importa tu lista de predios</h2><p>Sube CSV, Word (.docx), Excel (.xlsx) o PDF. En archivos con tablas, elige la hoja, la fila de encabezados y la columna que contiene el número de predio. Revisa los resultados antes de guardarlos.</p></div>
      <div className="portfolio-import-controls">
        <label className="portfolio-file-label">CSV / Word / Excel
          <input aria-label="Seleccionar CSV Word o Excel con columna de predio" type="file" accept=".csv,text/csv,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleTable} disabled={importing || remaining === 0}/>
        </label>
        <label className="portfolio-file-label">Seleccionar PDF
          <input aria-label="Seleccionar PDF con listado de predios" type="file" accept=".pdf,application/pdf" onChange={handlePdf} disabled={importing || remaining === 0}/>
        </label>
        <details><summary>También puedes pegar números de predio</summary><label htmlFor="portfolio-paste">Un número por línea</label><textarea id="portfolio-paste" rows={4} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'123456\n987654\n456789'}/><button type="button" className="secondary" onClick={handlePaste}>Revisar lista</button></details>
        <p className="note">Archivos hasta 15 MB. PDF de texto: hasta 100 páginas. No es OCR: un escaneo sin texto seleccionable no produce identificadores. Las áreas, régimen y parroquia se completan al consultar la ficha municipal, no se deducen del PDF. Después de importar, usa «Completar datos municipales» (hasta 10 por tanda) o abre cada ficha.</p>
      </div>
    </section>
    {importing && <p role="status">Leyendo archivo en este navegador…</p>}
    {tabular.length>0 && <section className="portfolio-table-config" aria-labelledby="portfolio-table-config-title">
      <span className="eyebrow">IDENTIFICAR COLUMNA DE PREDIO</span>
      <h3 id="portfolio-table-config-title">Configura la importación: {tabularName}</h3>
      <p>Detectamos un posible encabezado automáticamente. Confirma la hoja, la fila y la columna: el archivo puede contener otros números (avalúos, impuestos o cédulas) que no son predios.</p>
      <div className="portfolio-config-controls">
        {tabular.length>1 && <label>Tabla u hoja<select value={tabularSheet} onChange={e=>configureTable(tabular,Number(e.target.value))}>{tabular.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select></label>}
        <label>Fila de encabezados<select value={headerRow} onChange={e=>{setHeaderRow(Number(e.target.value));setPredioColumn(suggestedHeader([tabular[tabularSheet].rows[Number(e.target.value)]]).col);}}>
          {tabular[tabularSheet].rows.slice(0,Math.min(30,tabular[tabularSheet].rows.length)).map((r,i)=><option key={i} value={i}>Fila {i+1}: {r.filter(Boolean).slice(0,3).join(' · ').slice(0,95)||'Sin texto'}</option>)}
        </select></label>
        <label>Columna del número de predio<select value={predioColumn} onChange={e=>setPredioColumn(Number(e.target.value))}>
          {Array.from({length:Math.min(40,Math.max(1,...tabular[tabularSheet].rows.slice(0,Math.min(100,tabular[tabularSheet].rows.length)).map(r=>r.length)))},(_,i)=>
            <option key={i} value={i}>Columna {i+1}: {String(tabular[tabularSheet].rows[headerRow]?.[i]||'Sin encabezado').slice(0,75)}</option>)}
        </select></label>
      </div>
      <div className="portfolio-table-preview" role="region" aria-label="Vista previa de tabla importada" tabIndex={0}>
        <table><thead><tr><th>Fila</th>{Array.from({length:Math.min(8,Math.max(1,...tabular[tabularSheet].rows.slice(0,15).map(r=>r.length)))},(_,i)=><th key={i} className={i===predioColumn?'portfolio-target-column':''}>Col. {i+1}</th>)}</tr></thead>
        <tbody>{tabular[tabularSheet].rows.slice(Math.max(0,headerRow-1),Math.min(tabular[tabularSheet].rows.length,headerRow+7)).map((row,j)=><tr key={j}><th>{Math.max(0,headerRow-1)+j+1}</th>{Array.from({length:Math.min(8,Math.max(1,...tabular[tabularSheet].rows.slice(0,15).map(r=>r.length)))},(_,i)=><td key={i} className={i===predioColumn?'portfolio-target-column':''}>{String(row[i]??'').slice(0,80)}</td>)}</tr>)}</tbody></table>
      </div>
      <div className="portfolio-preview-actions"><button type="button" className="primary-action" onClick={previewColumn}>Extraer predios de esta columna →</button><button type="button" className="secondary" onClick={()=>{setTabular([]);setTabularName('');setCandidates([]);}}>Cancelar</button></div>
    </section>}
    {importError && <p className="error" role="alert">{importError}</p>}
    {importMessage && <p className="portfolio-notice" role="status">{importMessage}</p>}
    {candidates.length > 0 && <section className="portfolio-preview" aria-label="Revisar predios extraídos antes de guardar">
      <h3>Revisa antes de guardar: {fileName}</h3>
      <p>{candidates.length} identificadores encontrados, {selectedExisting} ya guardados. Desmarca cualquier número incorrecto. No se agregará ninguno sin tu confirmación.</p>
      {warnings.map((t, i) => <p key={i} className="note">{t}</p>)}
      <div className="portfolio-preview-grid">{candidates.map(p => {
        const exists = records.some(row => row.n_predio === p.n_predio);
        return <label key={p.n_predio} className="portfolio-preview-item"><input type="checkbox" disabled={exists} checked={!exists && chosen.includes(p.n_predio)} onChange={e => setChosen(old => e.target.checked ? [...old, p.n_predio] : old.filter(id => id !== p.n_predio))}/><span><strong>{p.n_predio}</strong><small>{exists ? 'Ya guardado' : p.page ? `PDF · página ${p.page}` : p.row ? `Fila ${p.row}` : 'Lista escrita'}{p.clave_cata ? ` · Clave: ${p.clave_cata}` : ''}</small></span></label>;
      })}</div>
      <div className="portfolio-preview-actions"><button type="button" className="primary-action" onClick={importApproved} disabled={!chosen.length || !remaining}>Agregar {Math.min(chosen.length,remaining)} a Selección</button><button type="button" className="secondary" onClick={() => {setCandidates([]);setChosen([]);setFileName('');}}>Cancelar</button></div>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}

    <section className="portfolio-list-section" aria-labelledby="portfolio-list-title">
      <div className="portfolio-list-heading"><div><span className="eyebrow">SEGUIMIENTO INDIVIDUAL</span><h2 id="portfolio-list-title">Predios en cartera</h2></div>{records.length > 0 && <span className="portfolio-summary">{records.filter(p => p.irmReview === 'manual_reviewed').length} marcados revisados · {records.filter(p => p.irmReview !== 'manual_reviewed').length} pendientes</span>}</div>
      {!records.length ? <div className="explorer-empty selection-empty"><h3>Tu cartera todavía está vacía.</h3><p>Agrega predios desde el mapa o importa un PDF/listado con sus números para empezar.</p><button type="button" className="secondary" onClick={onExplore}>Explorar predios →</button></div>
      : <>
        <div className="portfolio-filters"><label>Buscar<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Número, clave o parroquia"/></label><label>Revisión manual del IRM<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="pending">Pendiente</option><option value="reviewed">Marcado revisado</option></select></label></div>
        <div className="portfolio-list-wrap"><table className="portfolio-list"><thead><tr><th scope="col">Comparar</th><th scope="col">Predio</th><th scope="col">Información</th><th scope="col">IRM · seguimiento manual</th><th scope="col">Acciones</th></tr></thead>
        <tbody>{visible.map(p => <tr key={p.n_predio}>
          <td><input aria-label={`Comparar predio ${p.n_predio}`} type="checkbox" checked={comparison.includes(p.n_predio)} disabled={!comparison.includes(p.n_predio) && comparison.length >= COMPARISON_LIMIT} onChange={e => toggleCompare(p.n_predio,e.target.checked)}/></td>
          <td><strong>{p.n_predio}</strong><small>{p.source === 'pdf' ? 'Importado · sin verificación municipal' : 'Guardado desde consulta municipal'}</small></td>
          <td><span>{p.parroquia || 'Parroquia por consultar'}</span><small>{p.clave_cata || 'Clave por consultar'}</small></td>
          <td><label className="portfolio-reviewed"><input type="checkbox" checked={p.irmReview === 'manual_reviewed'} onChange={e => onIrmReview(p.n_predio, e.target.checked)}/><span>{p.irmReview === 'manual_reviewed' ? 'Marcado revisado' : 'Pendiente de revisión'}</span></label><small>Marca manual; no verifica el contenido del IRM</small></td>
          <td className="portfolio-actions"><button type="button" className="secondary" disabled={loading} onClick={() => onOpen(p.n_predio)} aria-label={`Abrir ficha e IRM del predio ${p.n_predio}`}>Abrir ficha / IRM ↗</button><button type="button" className="text-button" onClick={() => {onRemove(p.n_predio);setComparison(old => old.filter(id => id !== p.n_predio));}} aria-label={`Quitar predio ${p.n_predio}`}>Quitar</button></td>
        </tr>)}</tbody></table></div>
        {!visible.length && <p className="note">No hay predios que coincidan con los filtros.</p>}
        <div className="portfolio-compare-action"><p>{comparison.length} de {COMPARISON_LIMIT} seleccionados para comparación.</p><button type="button" className="secondary" disabled={!comparison.length} onClick={() => setShowCompare(v => !v)}>{showCompare ? 'Ocultar comparación' : 'Comparar seleccionados'}</button></div>
        {showCompare && compareRecords.length > 0 && <div className="comparison-scroll" tabIndex={0} role="region" aria-label="Comparación de predios seleccionados">
          <table className="comparison-table"><caption>Comparación de hasta {COMPARISON_LIMIT} predios · datos disponibles en la cartera</caption><thead><tr><th scope="col">Criterio</th>{compareRecords.map(p => <th scope="col" key={p.n_predio}>Predio <strong>{p.n_predio}</strong></th>)}</tr></thead>
            <tbody>{rows.map(([label, render]) => <tr key={label}><th scope="row">{label}</th>{compareRecords.map(p => <td key={p.n_predio}>{render(p)}</td>)}</tr>)}</tbody>
          </table>
        </div>}
      </>}
    </section>
    <p className="source-note">Los datos importados desde PDF son candidatos no verificados. Abre cada ficha para consultar el catastro municipal y obtener/revisar su IRM. El indicador «revisado» es exclusivamente un control manual y no implica validación oficial.</p>
  </section>;
}
