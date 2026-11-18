import React, {useEffect, useId, useRef, useState} from 'react';
import {comparePredioEvidence, coordinateCopyText, distanceBetweenLocations, effectiveLocation,
  formatLocationNumber, locationMapUrl, predioCandidates, validGeographic, validateReferenceDraft} from '../locationAnalysis.js';
import './DrawingLocationPanel.css';

const initialDraft = () => ({target: 'blueprint', mode: 'geographic', x: '', y: '', crs: '', label: ''});
const unitNames = {0: 'unidad sin confirmar', 1: 'pulgadas', 2: 'pies', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km'};
const roleNames = {
  reference_point: 'Punto de referencia', drawing_reference_point: 'Referencia del dibujo',
  geodata_reference_point: 'Referencia geográfica del dibujo', irm_reference_point: 'Punto indicado en el IRM',
  cad_geodata_reference_point: 'Punto de referencia geográfica del CAD', document_reference_point: 'Punto indicado en el documento',
  extracted_coordinate: 'Coordenada extraída del documento',
};

function statusLabel(location, isIrm) {
  if (!location) return 'Comprobación de ubicación pendiente';
  if (validGeographic(location.geographic)) return 'Latitud y longitud disponibles · sin verificar';
  if (location.status === 'needs_crs') return 'Coordenadas X/Y · sistema pendiente';
  if (location.status === 'unreferenced') return 'Coordenadas locales · ubicación no verificada';
  if (location.status === 'unsupported') return 'Referencia geográfica pendiente de revisión';
  return isIrm ? 'Sin coordenadas identificadas en el IRM' : 'Ubicación no identificada en el documento';
}

function GeographicPoint({point, label, pointLabel, sourceLabel}) {
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => setCopyStatus(''), [point.latitude, point.longitude]);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(coordinateCopyText(point));
      setCopyStatus('Latitud y longitud copiadas.');
    } catch { setCopyStatus('No se pudo copiar. Selecciona las coordenadas para copiarlas.'); }
  }
  return <div className="drawing-location-geographic">
    {sourceLabel && <p className="drawing-location-point-source">{sourceLabel}</p>}
    <dl className="drawing-location-coordinates">
      <div><dt>Latitud</dt><dd>{formatLocationNumber(point.latitude)}</dd></div>
      <div><dt>Longitud</dt><dd>{formatLocationNumber(point.longitude)}</dd></div>
    </dl>
    <p className="drawing-location-coordinate-basis">WGS84 · EPSG:4326 · {pointLabel || roleNames[point.point_role] || 'Punto de referencia del documento'}{Number.isInteger(point.page) && point.page > 0 ? ` · página ${point.page}` : ''}</p>
    <div className="drawing-location-point-actions">
      <button type="button" className="secondary" onClick={copy} aria-label={`Copiar coordenadas ${label}`}>Copiar coordenadas</button>
      <a href={locationMapUrl(point)} target="_blank" rel="noopener noreferrer" aria-label={`Ver punto ${label} en el mapa`}>Ver punto en mapa ↗</a>
    </div>
    {copyStatus && <p className="drawing-location-copy-status" role="status">{copyStatus}</p>}
  </div>;
}

function SourceDetails({document}) {
  const location = document?.location;
  if (!location) return null;
  const point = location.point;
  const extents = location.extents;
  const bounds = extents && Array.isArray(extents.min) && Array.isArray(extents.max) &&
    extents.min.length >= 2 && extents.max.length >= 2 &&
    [...extents.min, ...extents.max].every(value => typeof value === 'number' && Number.isFinite(value));
  const identifiers = (location.candidates || []).filter(item => ['predio', 'cadastral_key', 'crs_label'].includes(item.kind));
  const warnings = (location.warnings || []).filter(item => typeof item === 'string');
  if (!point && !bounds && !identifiers.length && !warnings.length && !location.crs) return null;
  return <details className="drawing-location-source-details">
    <summary>Ver coordenadas de origen y evidencia</summary>
    {location.crs && <p><strong>Sistema de origen:</strong> {[location.crs.id, location.crs.name].filter(Boolean).join(' · ')}</p>}
    {point && <p><strong>Punto en el documento:</strong> X {formatLocationNumber(point.x, 4)} · Y {formatLocationNumber(point.y, 4)}{Number.isFinite(point.z) ? ` · Z ${formatLocationNumber(point.z, 4)}` : ''}</p>}
    {bounds && <>
      <table className="drawing-location-extents"><caption>Extensión de coordenadas del modelo · {unitNames[extents.units_code] || `unidad CAD ${extents.units_code ?? 'sin confirmar'}`}</caption>
        <thead><tr><th scope="col">Eje</th><th scope="col">Mínimo</th><th scope="col">Máximo</th></tr></thead>
        <tbody>{['X', 'Y', 'Z'].slice(0, Math.min(extents.min.length, extents.max.length, 3)).map((axis, index) => <tr key={axis}><th scope="row">{axis}</th><td>{formatLocationNumber(extents.min[index], 4)}</td><td>{formatLocationNumber(extents.max[index], 4)}</td></tr>)}</tbody>
      </table>
      <p>Estas coordenadas pertenecen al dibujo original. Su extensión no define el límite de la parcela.</p>
      {String(extents.source || '').includes('header') && <p>Extensión guardada en la cabecera CAD; puede diferir de la geometría actual.</p>}
    </>}
    {identifiers.length > 0 && <ul className="drawing-location-evidence">{identifiers.map((item, index) => <li key={`${item.kind}-${index}`}><strong>{item.kind === 'predio' ? 'Predio' : item.kind === 'cadastral_key' ? 'Referencia catastral' : 'Sistema indicado'}:</strong> {item.value}{item.page ? ` · página ${item.page}` : ''} <span>(extracción sin verificar)</span></li>)}</ul>}
    {warnings.length > 0 && <ul className="drawing-location-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
  </details>;
}

function SourceCard({kind, document, reference, onRemove}) {
  const isIrm = kind === 'irm', label = isIrm ? 'IRM' : 'Plano';
  const geographic = validGeographic(document?.location?.geographic);
  const declared = document && validGeographic(reference?.geographic);
  const predios = predioCandidates(document);
  return <article className={`drawing-location-source drawing-location-source-${kind}`}>
    <header><h4>{label}</h4><span>{document ? 'Documento aportado' : 'Sin adjuntar'}</span></header>
    {document ? <>
      <p className="drawing-location-status">{statusLabel(document.location, isIrm)}</p>
      {geographic ? <GeographicPoint point={geographic} label={`del ${label}`} sourceLabel="Obtenidas del documento; asociación con el predio pendiente de revisión." />
        : <p className="drawing-location-explanation">{!document.location ? 'Vuelve a inspeccionar los documentos para comprobar sus referencias de ubicación.' : document.location.status === 'needs_crs' ? 'Las coordenadas extraídas necesitan un sistema de referencia confirmado para convertirse a latitud y longitud.' : isIrm ? 'Revisa las coordenadas y el sistema de referencia del informe. Puedes añadir una referencia documentada.' : 'Las coordenadas del plano permiten medir su geometría, pero no sitúan la propiedad en el mapa por sí solas.'}</p>}
      {predios.length > 0 && <p className="drawing-location-predio"><strong>Predio extraído:</strong> {predios.join(', ')} <span>· sin verificar</span></p>}
      <SourceDetails document={document} />
    </> : <p className="drawing-location-explanation">Adjunta el IRM para comparar sus referencias de ubicación con las del plano.</p>}
    {declared && <div className="drawing-location-declared">
      <p className="drawing-location-declared-title">Referencia declarada por ti · sin verificar</p>
      <GeographicPoint point={declared} label={`de la referencia del ${label}`} pointLabel="Referencia aportada por el usuario" sourceLabel={reference.label || 'Fuente aportada por el usuario'} />
      <p className="drawing-location-coordinate-basis">Origen: {reference.crs?.id || 'Sin confirmar'}{reference.crs?.name ? ` · ${reference.crs.name}` : ''}</p>
      {onRemove && <button type="button" className="secondary drawing-location-remove" onClick={onRemove}>Quitar referencia del {label}</button>}
    </div>}
  </article>;
}

export default function DrawingLocationPanel({blueprint, irm, selectedPredio, apiBase = '', reference = {}, onReferenceChange, compact = false}) {
  const id = useId();
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useRef(0), controller = useRef(null);
  const documents = useRef({blueprint, irm}), references = useRef(reference);
  documents.current = {blueprint, irm}; references.current = reference;
  const editable = typeof onReferenceChange === 'function' && !compact;
  const comparison = comparePredioEvidence(blueprint, irm, selectedPredio);
  const drawingPoint = effectiveLocation(blueprint, reference.blueprint), irmPoint = effectiveLocation(irm, reference.irm);
  const distance = distanceBetweenLocations(drawingPoint?.point, irmPoint?.point);
  const sourceForDraft = draft.target === 'irm' ? irm : blueprint;
  const extractedPoint = sourceForDraft?.location?.point;
  const canUseExtracted = extractedPoint && Number.isFinite(extractedPoint.x) && Number.isFinite(extractedPoint.y);

  const cancelRequest = () => { controller.current?.abort(); run.current++; setBusy(false); };
  useEffect(() => {
    cancelRequest(); setDraft(initialDraft()); setError(''); setNotice('');
    return () => { controller.current?.abort(); run.current++; };
  }, [blueprint, irm]);

  function change(key, value) {
    cancelRequest(); setError(''); setNotice('');
    setDraft(current => key === 'target' ? {...initialDraft(), target: value} : {...current, [key]: value});
  }
  function useExtracted() {
    if (!canUseExtracted) return;
    cancelRequest(); setError('');
    setDraft(current => ({...current, mode: 'projected', x: String(extractedPoint.x), y: String(extractedPoint.y),
      crs: sourceForDraft.location.crs?.id || '', label: `Coordenadas del ${draft.target === 'irm' ? 'IRM' : 'plano'} aportado`}));
    setNotice('Revisa X, Y y el sistema de origen antes de aplicar la referencia.');
  }
  async function apply(event) {
    event.preventDefault();
    const parsed = validateReferenceDraft(draft);
    if (parsed.error) { setError(parsed.error); setNotice(''); return; }
    if (!sourceForDraft) { setError('Adjunta el documento al que corresponde la referencia.'); return; }
    cancelRequest();
    const request = new AbortController(); controller.current = request;
    const runId = run.current, target = draft.target, sourceDocument = sourceForDraft;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 30000);
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${String(apiBase).replace(/\/$/, '')}/api/coordinates/transform`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({x: parsed.x, y: parsed.y, source_crs: parsed.source_crs}), signal: request.signal,
      });
      const result = await response.json().catch(() => null);
      if (runId !== run.current || documents.current[target] !== sourceDocument) return;
      if (!response.ok || !validGeographic(result?.geographic)) throw new Error(typeof result?.detail === 'string' ? result.detail : 'No se pudo obtener una latitud y longitud válidas con ese sistema. Revisa la fuente de las coordenadas.');
      onReferenceChange({...references.current, [target]: {...result, source: 'user_reference', label: parsed.label}});
      setNotice(`Referencia del ${target === 'irm' ? 'IRM' : 'plano'} aplicada a esta revisión. La geometría del plano no cambia.`);
    } catch (failure) {
      if (runId !== run.current || documents.current[target] !== sourceDocument || (request.signal.aborted && !timedOut)) return;
      setError(timedOut ? 'La conversión está tardando más de lo previsto. Vuelve a intentarlo.' : failure.message === 'Failed to fetch' ? 'No se pudo conectar con el servicio de coordenadas. Vuelve a intentarlo.' : failure.message);
    } finally {
      clearTimeout(timeout);
      if (runId === run.current) setBusy(false);
    }
  }
  function remove(target) {
    cancelRequest(); setNotice('Referencia retirada de esta revisión.'); setError('');
    const next = {...references.current}; delete next[target]; onReferenceChange(next);
  }

  return <section className={`drawing-location-panel${compact ? ' drawing-location-compact' : ''}`} aria-labelledby={`${id}-title`}>
    <div className="drawing-location-heading"><div><p className="eyebrow">PLANO + IRM</p><h3 id={`${id}-title`}>Ubicación y vínculo con el IRM</h3></div><span className="drawing-location-review">Revisión pendiente</span></div>
    <p className="drawing-location-intro">Comprueba las coordenadas y su procedencia antes de relacionar los documentos con una propiedad.</p>
    <div className="drawing-location-sources">
      <SourceCard kind="blueprint" document={blueprint} reference={reference.blueprint} onRemove={editable ? () => remove('blueprint') : null} />
      <SourceCard kind="irm" document={irm} reference={reference.irm} onRemove={editable ? () => remove('irm') : null} />
    </div>
    <div className={`drawing-location-comparison drawing-location-comparison-${comparison.status}`}>
      <h4>Relación entre las fuentes</h4>
      {String(selectedPredio ?? '').trim() && <p><strong>Predio seleccionado:</strong> {String(selectedPredio)}</p>}
      <p className="drawing-location-predio-comparison">{comparison.text}</p>
      {distance !== null && <p className="drawing-location-distance"><strong>Separación aproximada entre los puntos: {formatLocationNumber(distance >= 1000 ? distance / 1000 : distance, distance >= 1000 ? 2 : 1)} {distance >= 1000 ? 'km' : 'm'}.</strong> Plano: {drawingPoint.source === 'document' ? 'punto del documento' : 'referencia declarada'}; IRM: {irmPoint.source === 'document' ? 'punto del documento' : 'referencia declarada'}. Los puntos pueden representar lugares distintos del predio; la distancia no confirma que sea la misma parcela.</p>}
    </div>
    {editable && <details className="drawing-location-reference-form"><summary>Añadir referencia de ubicación</summary>
      <p>Introduce un punto cuya fuente conozcas. Se conserva como referencia declarada durante esta revisión; no coloca, gira ni escala el plano.</p>
      <form onSubmit={apply} noValidate>
        <div className="drawing-location-form-grid">
          <label htmlFor={`${id}-target`}>Documento de la referencia<select id={`${id}-target`} value={draft.target} onChange={event => change('target', event.target.value)}><option value="blueprint">Plano</option><option value="irm" disabled={!irm}>IRM</option></select></label>
          <label htmlFor={`${id}-mode`}>Tipo de coordenadas<select id={`${id}-mode`} value={draft.mode} onChange={event => change('mode', event.target.value)}><option value="geographic">Latitud / longitud · WGS84</option><option value="projected">X / Y con sistema de origen</option></select></label>
          <label htmlFor={`${id}-y`}>{draft.mode === 'geographic' ? 'Latitud' : 'Y (norte / segunda coordenada)'}<input id={`${id}-y`} aria-label={draft.mode === 'geographic' ? 'Latitud de referencia' : 'Coordenada Y de referencia'} inputMode="decimal" value={draft.y} maxLength={40} onChange={event => change('y', event.target.value)} /></label>
          <label htmlFor={`${id}-x`}>{draft.mode === 'geographic' ? 'Longitud' : 'X (este / primera coordenada)'}<input id={`${id}-x`} aria-label={draft.mode === 'geographic' ? 'Longitud de referencia' : 'Coordenada X de referencia'} inputMode="decimal" value={draft.x} maxLength={40} onChange={event => change('x', event.target.value)} /></label>
          {draft.mode === 'projected' && <label className="drawing-location-form-wide" htmlFor={`${id}-crs`}>Sistema de coordenadas de origen<input id={`${id}-crs`} value={draft.crs} maxLength={24} placeholder="EPSG:… o SIRES-DMQ" onChange={event => change('crs', event.target.value)} /><span>Usa la referencia indicada por el documento o el levantamiento. SIRES-DMQ de Quito equivale aquí a ESRI:103985.</span></label>}
          <label className="drawing-location-form-wide" htmlFor={`${id}-source`}>Fuente de la referencia<input id={`${id}-source`} value={draft.label} maxLength={160} placeholder="Por ejemplo: punto indicado en el levantamiento" onChange={event => change('label', event.target.value)} /></label>
        </div>
        {canUseExtracted && <button type="button" className="secondary drawing-location-prefill" onClick={useExtracted}>Usar X/Y extraídos del {draft.target === 'irm' ? 'IRM' : 'plano'}</button>}
        <div className="drawing-location-form-actions"><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Convirtiendo coordenadas…' : 'Usar referencia'}</button><p>Los cambios se aplican al pulsar «Usar referencia». La asociación que declares requiere comprobación.</p></div>
        {error && <p className="drawing-location-error" role="alert">{error}</p>}
        {notice && <p className="drawing-location-notice" role="status">{notice}</p>}
      </form>
    </details>}
    <p className="drawing-location-scope">Una referencia de ubicación no georreferencia la geometría ni acredita límites, medidas o correspondencia catastral. Los decimales mostrados no certifican precisión en terreno.</p>
  </section>;
}
