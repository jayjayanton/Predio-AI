import React, {lazy, Suspense, useEffect, useId, useMemo, useRef, useState} from 'react';
import {PLANNING_FIELDS, buildPlanningRequest, candidateField, downloadPlanningJson, extensionGeometryKey, initialPlannerDraft, invalidateCountedAreas,
  localPlanningExport, localSvgPath, nudgePlacement, parcelEdges, parcelIdentifier, placedPlanningExport,
  plannerContextKey, plannerSpatialKey, planningBounds, planningIdentity, polygonArea, preserveSpatialDraft, selectedParcelGeometry, usableFootprint} from '../footprintPlanning.js';
import './FootprintPlanner.css';

const FootprintMap = lazy(() => import('./FootprintMap.jsx'));
const fmt = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('es-EC', {maximumFractionDigits: digits}) : '—';
const CHECK_LABELS = {within_reviewed_limits: 'Dentro del límite revisado', conflict: 'Conflicto detectado', pending: 'Por revisar'};
const EDGE_KINDS = {front: 'Frontal', side: 'Lateral', rear: 'Posterior'};
const EMPTY = Object.freeze({});

class MapBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {return this.state.failed ? <p className="footprint-notice">No se pudo abrir el mapa. Puedes ajustar las coordenadas y descargar la geometría. Recarga la página para volver a intentarlo.</p> : this.props.children;}
}

function LocalFootprintPreview({snapshot}) {
  const bounds = planningBounds(snapshot);
  const gridId = useId().replaceAll(':', '');
  if (!bounds) return null;
  const width = Math.max(bounds[2] - bounds[0], 1), height = Math.max(bounds[3] - bounds[1], 1);
  const padding = Math.max(width, height) * 0.12;
  const extent = [bounds[0] - padding, -bounds[3] - padding, width + padding * 2, height + padding * 2];
  const maxDimension = Math.max(width, height);
  const grid = maxDimension <= 15 ? 1 : maxDimension <= 60 ? 5 : maxDimension <= 150 ? 10 : 50;
  return <div className="footprint-local-preview">
    <div className="footprint-preview-label"><span>VISTA EN PLANTA</span><span>Cuadrícula · {grid} m</span></div>
    <svg viewBox={extent.join(' ')} role="img" aria-label="Huella extraída y figuras propuestas a la misma escala, en coordenadas locales">
      <defs><pattern id={gridId} width={grid} height={grid} patternUnits="userSpaceOnUse"><path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="#d9e4dc" strokeWidth={Math.min(maxDimension / 1100, grid / 30)}/></pattern></defs>
      <rect x={extent[0]} y={extent[1]} width={extent[2]} height={extent[3]} fill={`url(#${gridId})`}/>
      <path d={localSvgPath(snapshot.footprint)} fill="#4e967b35" fillRule="evenodd" stroke="#286653" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      {(snapshot.shapes || []).map(shape => <path key={shape.id} d={localSvgPath(shape.geometry)} fill={shape.role === 'extension' ? '#d5934a45' : '#7886a733'}
        stroke={shape.role === 'extension' ? '#b46e2b' : '#667593'} strokeWidth="1.8" strokeDasharray={shape.role === 'extension' ? '6 4' : undefined} fillRule="evenodd" vectorEffect="non-scaling-stroke"><title>{shape.label || (shape.role === 'extension' ? 'Ampliación' : 'Mobiliario')}</title></path>)}
      <g stroke="#35544c" strokeWidth="1.2" vectorEffect="non-scaling-stroke"><path d={`M ${-maxDimension * .018} 0 H ${maxDimension * .018} M 0 ${-maxDimension * .018} V ${maxDimension * .018}`}/></g>
    </svg>
    <div className="footprint-preview-dimensions"><span>Extensión del conjunto <strong>{fmt(width)} × {fmt(height)} m</strong></span><span>Origen local <strong>0, 0</strong></span></div>
  </div>;
}

function StatusChecks({result, pending, error, onRetry}) {
  if (error) return <div className="footprint-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>Reintentar análisis</button></div>;
  if (!result) return <div className="footprint-checks-waiting" role="status">{pending ? 'Calculando la geometría y revisando los datos disponibles…' : 'Completa los datos disponibles para revisar la propuesta.'}</div>;
  return <div className="footprint-check-results">
    <div className="footprint-check-heading"><div><span className="footprint-eyebrow">REVISIÓN PRELIMINAR</span><h4>Qué encaja y qué falta revisar</h4></div><span className="footprint-badge">Sin validación municipal</span></div>
    <ul className="footprint-check-list">{(result.checks || []).map(check => <li key={check.id} className={`footprint-check is-${check.status}`}>
      <span className="footprint-check-icon" aria-hidden="true">{check.status === 'conflict' ? '!' : check.status === 'within_reviewed_limits' ? '✓' : '·'}</span>
      <div><div className="footprint-check-title"><strong>{check.title}</strong><span>{CHECK_LABELS[check.status] || 'Por revisar'}</span></div><p>{check.message}</p>
        {typeof check.actual === 'number' && typeof check.limit === 'number' && <small>{fmt(check.actual)} {check.unit || ''} · límite revisado {fmt(check.limit)} {check.unit || ''}</small>}
      </div>
    </li>)}</ul>
    {result.warnings?.length > 0 && <details className="footprint-method"><summary>Alcance de esta revisión</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
  </div>;
}

/** A selected CAD footprint stays local until explicitly positioned on a linked parcel. */
export default function FootprintPlanner({snapshot, parcel = null, parcelProperties = EMPTY, blueprint = null, irm = null, apiBase = '', onLinkParcel,
  state: savedState, onStateChange}) {
  const titleId = useId();
  const geometry = useMemo(() => selectedParcelGeometry(parcel, parcelProperties), [parcel, parcelProperties]);
  const hasFootprint = usableFootprint(snapshot);
  const contextKey = useMemo(() => plannerContextKey(snapshot, geometry, irm, parcelProperties), [snapshot, geometry, irm, parcelProperties]);
  const spatialContextKey = useMemo(() => plannerSpatialKey(snapshot, geometry, parcelProperties), [snapshot, geometry, parcelProperties]);
  const extensionKey = useMemo(() => extensionGeometryKey(snapshot), [snapshot]);
  const defaults = useMemo(() => initialPlannerDraft({geometry, properties: parcelProperties, irm}), [contextKey]);
  const [record, setRecord] = useState(() => savedState?.contextKey === contextKey ? savedState
    : {contextKey, spatialContextKey, extensionKey, draft: preserveSpatialDraft(defaults, savedState, spatialContextKey)});
  const [resultRecord, setResultRecord] = useState(() => savedState?.contextKey === contextKey ? savedState.resultRecord || null : null);
  const [errorRecord, setErrorRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedEdge, setSelectedEdge] = useState('');
  const [nudge, setNudge] = useState('0.5');
  const callback = useRef(onStateChange);
  callback.current = onStateChange;
  const draft = useMemo(() => record.contextKey !== contextKey ? preserveSpatialDraft(defaults, record, spatialContextKey)
    : record.extensionKey === extensionKey ? record.draft : invalidateCountedAreas(record.draft), [record, contextKey, spatialContextKey, extensionKey, defaults]);
  const identity = useMemo(() => planningIdentity(blueprint, irm, parcelProperties), [blueprint, irm, parcelProperties]);
  const identityMismatch = identity.mismatch || Boolean(!identity.report.length && draft.manualIrmPredio?.trim()
    && identity.selected && draft.manualIrmPredio.trim() !== identity.selected);
  const edges = useMemo(() => parcelEdges(geometry), [geometry]);
  const candidateFlags = irm?.planning_evidence?.flags || [];
  const knownHorizontal = /horizontal/i.test(String(parcelProperties?.tipo_propi || '')) || irm?.planning_evidence?.property_regime === 'horizontal';
  const built = useMemo(() => buildPlanningRequest({snapshot, geometry, properties: parcelProperties, blueprint, irm, draft}), [snapshot, geometry, parcelProperties, blueprint, irm, draft]);
  const requestKey = built.request ? JSON.stringify(built.request) : '';
  const result = resultRecord?.key === requestKey ? resultRecord.value : null;
  const error = errorRecord?.key === requestKey ? errorRecord.message : '';
  const extensions = (snapshot?.shapes || []).filter(shape => shape.role === 'extension');
  const placement = built.request?.placement;

  useEffect(() => {
    setRecord(current => {
      const base = current.contextKey === contextKey ? current : savedState?.contextKey === contextKey ? savedState
        : {contextKey, spatialContextKey, extensionKey, draft: preserveSpatialDraft(defaults, current, spatialContextKey)};
      return base.extensionKey === extensionKey ? base : {...base, extensionKey, draft: invalidateCountedAreas(base.draft)};
    });
    setSelectedEdge('');
  }, [contextKey, spatialContextKey, extensionKey]);
  useEffect(() => {
    if (record.contextKey === contextKey && record.extensionKey === extensionKey) callback.current?.({contextKey, spatialContextKey, extensionKey, draft: record.draft, resultRecord});
  }, [record, contextKey, spatialContextKey, extensionKey, resultRecord]);
  useEffect(() => {
    if (!requestKey) {setBusy(false); return undefined;}
    if (resultRecord?.key === requestKey && retry === 0) {setBusy(false); return undefined;}
    const controller = new AbortController();
    let active = true, timeout = null, timedOut = false;
    setBusy(true); setErrorRecord(null);
    const debounce = setTimeout(async () => {
      timeout = setTimeout(() => {timedOut = true; controller.abort();}, 45000);
      try {
        const response = await fetch(`${apiBase}/api/planning/assess`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: requestKey, signal: controller.signal});
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'No se pudo revisar esta geometría. Comprueba la huella y los valores introducidos.');
        if (!payload.metrics || !Array.isArray(payload.checks)) throw new Error('El servicio no devolvió una revisión completa. Vuelve a intentarlo.');
        if (active) setResultRecord({key: requestKey, value: payload});
      } catch (problem) {
        if (active && (!controller.signal.aborted || timedOut)) setErrorRecord({key: requestKey, message: timedOut
          ? 'El servicio está tardando en responder. La huella local sigue disponible; vuelve a intentar el análisis.'
          : String(problem.message || 'No se pudo conectar con el análisis de implantación.')});
      } finally {clearTimeout(timeout); if (active) setBusy(false);}
    }, 300);
    return () => {active = false; clearTimeout(debounce); clearTimeout(timeout); controller.abort();};
  }, [requestKey, apiBase, retry]);

  const update = updater => setRecord(current => {
    const previous = current.contextKey !== contextKey ? preserveSpatialDraft(defaults, current, spatialContextKey)
      : current.extensionKey === extensionKey ? current.draft : invalidateCountedAreas(current.draft);
    return {contextKey, spatialContextKey, extensionKey, draft: typeof updater === 'function' ? updater(previous) : {...previous, ...updater}};
  });
  const changePlacement = value => update(previous => ({...previous, placement: {...previous.placement, ...value, confirmed: false}}));
  const setField = (key, value) => update(previous => ({...previous, fields: {...previous.fields, [key]: value}, reviewed: false}));
  const move = (east, north) => {
    const next = nudgePlacement(draft.placement, east * Number(nudge), north * Number(nudge));
    if (next) update({placement: next});
  };
  const returnToDrawing = () => document.getElementById('drawing-workspace')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  const activeTab = draft.activeTab || 'footprint';
  const existingArea = result?.metrics?.existing_footprint_m2 ?? polygonArea(snapshot?.footprint);
  const classified = Object.values(draft.edgeKinds).filter(value => Object.hasOwn(EDGE_KINDS, value)).length;

  return <section className={`footprint-planner${hasFootprint ? '' : ' is-empty'}`} aria-labelledby={titleId}>
    <header className="footprint-header"><div><span className="footprint-eyebrow">DEL PLANO AL TERRENO</span><h3 id={titleId}>Ensaya una ampliación a escala</h3>
      <p>Extrae la huella, prueba su ubicación y contrasta los datos disponibles del IRM.</p></div><span className="footprint-badge">Estudio de implantación</span></header>
    {!hasFootprint ? <div className="footprint-empty-state"><svg viewBox="0 0 112 84" aria-hidden="true"><path d="M15 69V26L68 12 98 31V69Z" fill="#edf2ec" stroke="#8aa898" strokeWidth="1.5" strokeDasharray="4 4"/><path d="M31 58V33H59V44H78V58Z" fill="#d3e6db" stroke="#27614b" strokeWidth="2"/><path d="M78 44H93V58H78" fill="#f1dec6" stroke="#b6793a" strokeWidth="2" strokeDasharray="3 2"/></svg>
      <div><h4>Primero, elige el contorno de planta baja</h4><p>En el visor, confirma la escala y selecciona un contorno cerrado. Usa <strong>Usar como huella</strong> cuando hayas identificado el límite que quieres estudiar.</p>
        <p className="footprint-fine">Puedes añadir figuras y trabajar con el plano sin disponer de predio ni IRM.</p></div><button type="button" onClick={returnToDrawing}>Ir al plano ↑</button></div> : <>
      <div className="footprint-source"><span>HUELLA SELECCIONADA</span><strong>{snapshot.source?.documentName || 'Dibujo actual'}</strong><small>{snapshot.source?.viewName || 'Vista actual'}{snapshot.source?.entityId ? ` · ${snapshot.source.entityId}` : ''}</small></div>
      <nav className="footprint-tabs" aria-label="Etapas de implantación">{[['footprint', '01', 'Huella y propuesta'], ['placement', '02', 'Ubicar en el predio'], ['irm', '03', 'Revisar con el IRM']].map(([tab, number, label]) =>
        <button type="button" key={tab} className={activeTab === tab ? 'is-active' : ''} aria-pressed={activeTab === tab} onClick={() => update({activeTab: tab})}><span>{number}</span>{label}</button>)}</nav>
      <div className="footprint-metrics" aria-live="polite"><div><span>Huella existente</span><strong>{fmt(existingArea)} <small>m²</small></strong></div>
        <div><span>Área añadida por ampliación</span><strong>{fmt(result?.metrics?.extension_added_m2)} <small>m²</small></strong><small>Sin duplicar solapes</small></div>
        <div><span>Huella geométrica resultante</span><strong>{fmt(result?.metrics?.combined_footprint_m2)} <small>m²</small></strong><small>Mobiliario excluido</small></div>
      </div>

      {activeTab === 'footprint' && <div className="footprint-preview-grid"><LocalFootprintPreview snapshot={snapshot}/><div className="footprint-preview-detail">
        <span className="footprint-eyebrow">TU PROPUESTA</span><h4>La misma escala, en cada vista</h4><p>El contorno conserva sus huecos interiores. Las figuras marcadas como ampliación se suman a la ocupación; las mesas y otros muebles solo ayudan a visualizar el espacio.</p>
        <div className="footprint-legend"><span><i className="is-existing"/>Huella existente</span><span><i className="is-extension"/>Ampliación</span><span><i className="is-furniture"/>Mobiliario</span></div>
        <p className="footprint-item-count"><strong>{extensions.length}</strong> {extensions.length === 1 ? 'figura de ampliación' : 'figuras de ampliación'} · <strong>{(snapshot.shapes || []).length - extensions.length}</strong> de mobiliario</p>
        {snapshot.source?.approximate && <p className="footprint-fine">El contorno contiene curvas aproximadas por segmentos.</p>}
        <label className="footprint-check-label"><input type="checkbox" checked={draft.fullGroundFootprint} onChange={event => update({fullGroundFootprint: event.target.checked})}/><span>El contorno representa la planta baja y contiene toda la ocupación existente del terreno.</span></label>
        <p className="footprint-fine">Esta confirmación permite comparar la ocupación con el COS cuando haya un IRM correspondiente. Revisa que no falten otros bloques o construcciones.</p>
        <div className="footprint-actions"><button type="button" className="footprint-primary" onClick={() => update({activeTab: 'placement'})}>Ubicar en el predio →</button><button type="button" onClick={() => downloadPlanningJson(localPlanningExport(snapshot), 'predioai-huella-local.json')}>Descargar polígono local</button></div>
        <p className="footprint-fine">La descarga local usa metros y conserva la fuente y la escala. Aún no tiene coordenadas geográficas.</p>
      </div></div>}

      {activeTab === 'placement' && (!geometry ? <div className="footprint-missing"><span className="footprint-empty-symbol" aria-hidden="true">⌖</span><div><h4>La huella está lista. Falta el predio.</h4><p>Vincula el predio correspondiente para colocar el contorno sobre su polígono. El dibujo conserva sus dimensiones y tú defines su posición y orientación.</p>
        <p className="footprint-fine">No se ha atribuido este plano a una propiedad ni a una ubicación.</p></div>{onLinkParcel && <button type="button" className="footprint-primary" onClick={onLinkParcel}>Vincular predio</button>}</div> : <>
        <div className="footprint-placement-grid"><div><MapBoundary key={JSON.stringify(geometry)}><Suspense fallback={<div className="footprint-map-loading" role="status">Preparando el mapa de implantación…</div>}><FootprintMap geometry={geometry} placement={draft.placement} placed={result?.placed} onPlacementChange={changePlacement}/></Suspense></MapBoundary></div>
          <div className="footprint-placement-controls"><span className="footprint-eyebrow">UBICACIÓN PROPUESTA</span><h4>Predio {parcelIdentifier(parcelProperties) || 'vinculado'}</h4><p>La primera posición usa el centro de la extensión del predio como punto de partida. Ajusta el origen y el giro con una referencia del terreno.</p>
            <div className="footprint-fields"><label>Latitud del origen<input type="text" inputMode="decimal" value={draft.placement?.latitude || ''} onChange={event => changePlacement({latitude: event.target.value})}/></label>
              <label>Longitud del origen<input type="text" inputMode="decimal" value={draft.placement?.longitude || ''} onChange={event => changePlacement({longitude: event.target.value})}/></label>
              <label className="footprint-wide">Giro horario (°)<input type="number" min="-360" max="360" step="1" value={draft.placement?.rotation_degrees || '0'} onChange={event => changePlacement({rotation_degrees: event.target.value})}/></label></div>
            <div className="footprint-nudge"><label>Paso de desplazamiento<select value={nudge} onChange={event => setNudge(event.target.value)}><option value="0.1">0,10 m</option><option value="0.5">0,50 m</option><option value="1">1 m</option><option value="5">5 m</option></select></label>
              <div className="footprint-nudge-buttons"><button type="button" onClick={() => move(0, 1)} aria-label="Mover huella al norte">↑ N</button><button type="button" onClick={() => move(-1, 0)} aria-label="Mover huella al oeste">← O</button><button type="button" onClick={() => move(1, 0)} aria-label="Mover huella al este">E →</button><button type="button" onClick={() => move(0, -1)} aria-label="Mover huella al sur">↓ S</button></div></div>
            <label className="footprint-check-label"><input type="checkbox" checked={Boolean(draft.placement?.confirmed)} onChange={event => update(previous => ({...previous, placement: {...previous.placement, confirmed: event.target.checked}}))}/><span>Revisé la posición y la orientación de esta implantación.</span></label>
            <p className="footprint-fine">Mover el origen o cambiar el giro vuelve a dejar esta revisión pendiente. La escala no se modifica para encajar en el lote.</p>
            <div className="footprint-actions"><button type="button" className="footprint-primary" onClick={() => update({activeTab: 'irm'})}>Revisar con el IRM →</button><button type="button" disabled={!result?.placed} onClick={() => downloadPlanningJson(placedPlanningExport(result, snapshot, parcelProperties), 'predioai-implantacion-propuesta.geojson')}>Descargar GeoJSON</button></div>
            <p className="footprint-fine">GeoJSON en WGS84, con la ubicación propuesta y su procedencia. No equivale a una georreferenciación comprobada.</p>
          </div></div>
        <div className="footprint-spatial-summary">{result && <><span>Área del polígono del predio <strong>{fmt(result.metrics?.parcel_geometry_m2)} m²</strong></span><span>Ocupación fuera del predio <strong>{fmt(result.metrics?.outside_parcel_m2)} m²</strong></span></>}{busy && <span role="status">Actualizando implantación…</span>}</div>
      </>)}

      {activeTab === 'irm' && (!irm ? <div className="footprint-missing"><span className="footprint-empty-symbol" aria-hidden="true">▤</span><div><h4>El IRM de este plano todavía no está disponible</h4><p>Puedes seguir probando formas y ubicaciones. Adjunta el IRM correspondiente en los documentos del proyecto para incorporar sus parámetros a este estudio.</p><p className="footprint-fine">La factibilidad, los retiros y el COS permanecen pendientes.</p></div><button type="button" onClick={returnToDrawing}>Volver a los documentos ↑</button></div> : <>
        <div className="footprint-review-intro"><div><span className="footprint-eyebrow">DATOS DEL IRM APORTADO</span><h4>Confirma las condiciones del predio</h4><p>Los valores extraídos son candidatos. Contrástalos con el documento, corrige lo necesario y deja vacíos los datos que aún no conoces.</p></div><span className="footprint-badge">Revisión del usuario</span></div>
        {draft.documentChanged && <p className="footprint-notice" role="status">Se actualizó el IRM. Conservamos la posición de la huella; revisa los nuevos parámetros y las áreas computables.</p>}
        {identityMismatch && <div className="footprint-error" role="alert"><strong>Los identificadores de predio no coinciden.</strong><p>Seleccionado: {identity.selected || 'sin identificar'} · Plano: {identity.drawing.join(', ') || 'sin identificar'} · IRM: {identity.report.join(', ') || draft.manualIrmPredio || 'sin identificar'}. Corrige la vinculación o los documentos antes de comparar condiciones normativas.</p></div>}
        {candidateFlags.length > 0 && <div className="footprint-notice"><strong>El documento contiene condiciones que requieren revisión específica.</strong><ul>{candidateFlags.map((flag, index) => <li key={index}>{flag.evidence || ({horizontal_property: 'Propiedad horizontal', multiple_parameter_sets: 'Varias asignaciones o valores normativos', special_restrictions: 'Afectaciones o condiciones especiales'}[flag.kind] || flag.kind)}{flag.page ? ` · página ${flag.page}` : ''}</li>)}</ul></div>}
        <div className="footprint-review-grid"><div className="footprint-identity-evidence"><span>Predio vinculado</span><strong>{identity.selected || 'Pendiente'}</strong><span>Predio extraído del IRM</span><strong>{identity.report.join(', ') || 'Sin identificar'}</strong></div>
          {!identity.report.length && <label>Número de predio que consta en el IRM<input type="text" inputMode="numeric" maxLength="25" placeholder="Consultar el documento" value={draft.manualIrmPredio || ''} onChange={event => update({manualIrmPredio: event.target.value, associationConfirmed: false, reviewed: false})}/><span className="footprint-fine">Referencia introducida por ti; no se ha extraído automáticamente.</span></label>}</div>
        <div className="footprint-irm-fields">{PLANNING_FIELDS.map(field => {const candidate = candidateField(irm, field.key); return <label key={field.key}>{field.label}{field.unit && <small>{field.unit}</small>}<input type="text" inputMode="decimal" value={draft.fields[field.key] || ''} placeholder="Pendiente" onChange={event => setField(field.key, event.target.value)}/><span>{candidate.text !== '' ? `Extraído: ${candidate.text}${field.unit ? ` ${field.unit}` : ''}${candidate.page ? ` · pág. ${candidate.page}` : ''}` : 'Sin un valor único extraído'}{candidate.evidence && <details><summary>Ver evidencia</summary><p>{candidate.evidence}</p></details>}</span></label>;})}</div>
        <div className="footprint-counted-area"><h4>Área computable para el COS</h4><p>La huella geométrica no siempre coincide con el área útil o computable del municipio. Introduce el área final revisada de planta baja, incluyendo lo existente y la ampliación.</p>
          {draft.proposalChanged && <p className="footprint-notice" role="status">Cambió la ampliación. Revisa de nuevo las áreas computables de planta baja y del conjunto.</p>}
          <div className="footprint-review-grid"><label>Área útil/computable final en planta baja (m²)<input type="text" inputMode="decimal" placeholder="Pendiente de revisión" disabled={draft.footprintIsCountedArea} value={draft.proposal.ground_floor_counted_area_m2 || ''} onChange={event => update(previous => ({...previous, proposalChanged: false, proposal: {...previous.proposal, ground_floor_counted_area_m2: event.target.value}}))}/></label>
            <label className="footprint-check-label"><input type="checkbox" checked={Boolean(draft.footprintIsCountedArea)} onChange={event => update(previous => ({...previous, proposalChanged: event.target.checked ? false : previous.proposalChanged, footprintIsCountedArea: event.target.checked, proposal: {...previous.proposal, ground_floor_counted_area_m2: ''}}))}/><span>Revisé que la huella resultante coincide con el área útil/computable en planta baja.</span></label></div>
          <p className="footprint-fine">El COS permanece pendiente mientras no se confirme una de estas dos referencias. Las áreas de todos los pisos se revisan por separado.</p>
          {result?.metrics?.counted_ground_area_m2 != null && <p className="footprint-counted-result">Área computable utilizada: <strong>{fmt(result.metrics.counted_ground_area_m2)} m²</strong>{result.metrics.coverage_percent != null && <> · COS PB de la propuesta: <strong>{fmt(result.metrics.coverage_percent)} %</strong></>}</p>}
        </div>
        <div className="footprint-review-grid"><label>Régimen de la propiedad<select value={knownHorizontal ? 'horizontal' : draft.regime} disabled={knownHorizontal} onChange={event => update({regime: event.target.value, reviewed: false})}><option value="unknown">Pendiente de revisión</option><option value="individual">Propiedad individual</option><option value="horizontal">Propiedad horizontal</option></select></label>
          <label>Asignación normativa aplicable<select value={draft.zone} onChange={event => update({zone: event.target.value, reviewed: false})}><option value="unknown">Pendiente de revisión</option><option value="single">Una asignación aplicable confirmada</option><option value="multiple">Varias asignaciones por resolver</option></select></label>
          <label>Afectaciones y condiciones especiales<select value={draft.restrictions} onChange={event => update({restrictions: event.target.value, reviewed: false})}><option value="unknown">Pendientes de revisión</option><option value="none">Revisadas: sin condiciones especiales</option><option value="special">Hay condiciones especiales por resolver</option></select></label>
          <label>Referencia de la revisión<input type="text" maxLength="200" value={draft.sourceLabel} placeholder="Página, fecha o nota de revisión" onChange={event => update({sourceLabel: event.target.value, reviewed: false})}/></label></div>
        <div className="footprint-confirmations"><label className="footprint-check-label"><input type="checkbox" disabled={identityMismatch || !geometry} checked={draft.associationConfirmed && !identityMismatch && Boolean(geometry)} onChange={event => update({associationConfirmed: event.target.checked})}/><span>Confirmo que este plano y este IRM corresponden al predio vinculado.</span></label>
          <label className="footprint-check-label"><input type="checkbox" checked={draft.fullGroundFootprint} onChange={event => update({fullGroundFootprint: event.target.checked})}/><span>El contorno representa la planta baja y contiene toda la ocupación existente del terreno.</span></label>
          <label className="footprint-check-label"><input type="checkbox" checked={draft.reviewed} onChange={event => update({reviewed: event.target.checked, documentChanged: false})}/><span>Contrasté los valores introducidos y las condiciones aplicables con el IRM.</span></label>
          {!geometry && <p className="footprint-fine">Vincula primero el predio correspondiente para revisar la relación entre los documentos.</p>}</div>
        <details className="footprint-advanced"><summary>Retiros: identificar los lados del predio <span>{classified}/{edges.length || '—'} asignados</span></summary><p>Selecciona cada lado en el mapa o en la lista y clasifícalo según el frente vial y el IRM. No se deduce el frente a partir del norte ni de la forma del lote.</p>
          {geometry ? <div className="footprint-edge-grid"><MapBoundary><Suspense fallback={<p>Preparando los lados del predio…</p>}><FootprintMap geometry={geometry} placement={draft.placement} placed={result?.placed} onPlacementChange={changePlacement} edgesVisible selectedEdge={selectedEdge} onSelectEdge={setSelectedEdge} edgeKinds={draft.edgeKinds}/></Suspense></MapBoundary>
            <div className="footprint-edge-list" aria-label="Clasificación de lados del predio">{edges.map(edge => <label key={edge.id} className={selectedEdge === edge.id ? 'is-selected' : ''} onFocus={() => setSelectedEdge(edge.id)}>{edge.label}<select aria-label={`Clasificación de ${edge.label.toLowerCase()}`} value={draft.edgeKinds[edge.id] || ''} onChange={event => update(previous => ({...previous, edgeKinds: {...previous.edgeKinds, [edge.id]: event.target.value}}))}><option value="">Sin asignar</option>{Object.entries(EDGE_KINDS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>)}</div>
          </div> : <p className="footprint-fine">Los lados estarán disponibles cuando vincules un predio.</p>}</details>
        <details className="footprint-advanced"><summary>Altura, pisos y superficie total de la propuesta</summary><p>Introduce los totales finales del conjunto de edificaciones, incluyendo lo existente. La planta baja por sí sola no permite inferir estos valores.</p>
          <div className="footprint-review-grid">{[['height_m', 'Altura máxima final (m)'], ['floors', 'Número final de pisos'], ['total_floor_area_m2', 'Área computable final de todos los pisos (m²)']].map(([key, label]) => <label key={key}>{label}<input type="text" inputMode="decimal" placeholder="Pendiente" value={draft.proposal[key]} onChange={event => update(previous => ({...previous, proposal: {...previous.proposal, [key]: event.target.value}}))}/></label>)}</div></details>
        <StatusChecks result={result} pending={busy} error={error} onRetry={() => setRetry(value => value + 1)}/>
      </>)}
      {built.error && <p className="footprint-error" role="alert">{built.error}</p>}
      {error && activeTab !== 'irm' && <div className="footprint-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar análisis</button></div>}
      <footer className="footprint-footer"><span>{geometry ? `Predio ${parcelIdentifier(parcelProperties) || 'vinculado'}` : 'Sin predio vinculado'} · {irm ? 'IRM aportado' : 'Sin IRM'} · {placement?.confirmed ? 'Implantación revisada por ti' : 'Ubicación pendiente de revisión'}</span><p>Este estudio compara geometría y condiciones introducidas. No determina viabilidad estructural, derechos de construcción ni aprobación municipal.</p></footer>
    </>}
  </section>;
}
