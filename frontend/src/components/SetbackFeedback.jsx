import React from 'react';
import './SetbackFeedback.css';

const EDGE_KINDS = {front: 'Frontal', side: 'Lateral', rear: 'Posterior'};
const PENDING_REASONS = {
  identity: 'Vincula el IRM al mismo predio y confirma su revisión.',
  scope: 'Confirma la planta baja completa y las condiciones aplicables al lote.',
  placement: 'Confirma la ubicación y la orientación de la huella sobre el predio.',
  area_consistency: 'Contrasta las áreas del predio y del IRM antes de aplicar los retiros.',
  unclassified_edges: 'Falta identificar todos los linderos del predio.',
  missing_limits: 'Faltan retiros revisados para uno o más linderos.',
  parcel_holes: 'Los huecos del predio requieren una revisión adicional.',
  stale: 'Actualizando la revisión después de cambiar sus datos de referencia.',
  drawing_incomplete: 'Marca al menos tres puntos para revisar el contorno.',
  review_required: 'Confirma el predio, la implantación y los retiros aplicables del IRM para revisar esta figura.',
  geometry_unavailable: 'La geometría de esta figura todavía no permite calcular los retiros.',
  complex_geometry: 'Este contorno requiere una revisión geométrica adicional.',
  complexity: 'La geometría supera el alcance de la revisión en vivo; simplifica el contorno o revisa por partes.',
};
const STATUS_ICONS = {conflict: '!', at_limit: '↔', within_reviewed_limits: '✓', pending: '·'};

export function setbackMeasure(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.0001) return '< 0,0001';
  return value.toLocaleString('es-EC', {maximumFractionDigits: 4});
}

export function setbackStatusLabel(check) {
  if (!check || check.role === 'furniture' || check.status === 'not_applicable') return 'No aplica a mobiliario';
  if (check.status === 'conflict') return check.containment_status === 'conflict' ? 'Fuera del predio' : 'Retiro invadido';
  return {at_limit: 'En el límite', within_reviewed_limits: 'Dentro de los retiros revisados', pending: 'Retiros por revisar'}[check.status] || 'Retiros por revisar';
}

export function setbackEdgeLabel(edge) {
  const kind = EDGE_KINDS[edge?.kind] || 'Lindero';
  const part = Number.isInteger(edge?.polygon) && edge.polygon > 0 ? ` · sector ${edge.polygon + 1}` : '';
  return `${kind}${Number.isInteger(edge?.edge) ? ` · lado ${edge.edge + 1}` : ''}${part}`;
}

function controllingEdge(check) {
  const edges = (check?.setback_edges || []).filter(edge => typeof edge.actual_m === 'number' && Number.isFinite(edge.actual_m)
    && typeof edge.required_m === 'number' && Number.isFinite(edge.required_m) && edge.status !== 'pending');
  return [...edges].sort((a, b) => (a.actual_m - a.required_m) - (b.actual_m - b.required_m))[0] || null;
}

function titleFor(check, status) {
  if (status === 'conflict') {
    const subject = check.role === 'existing' ? 'La huella existente' : 'La ampliación';
    return check.containment_status === 'conflict' ? `${subject} sale del predio` : `${subject} invade el retiro revisado`;
  }
  return setbackStatusLabel({...check, status});
}

/** Feedback for one figure. A proposal conflict remains editable and is never an approval decision. */
export default function SetbackFeedback({check, compact = false, live = false}) {
  if (!check || check.role === 'furniture' || check.status === 'not_applicable') return null;
  const status = Object.hasOwn(STATUS_ICONS, check.status) ? check.status : 'pending';
  const edge = controllingEdge(check);
  const title = titleFor(check, status);
  const conflicts = (check.setback_edges || []).filter(item => item.status === 'conflict');
  const reasons = [...new Set((check.pending_reasons || []).map(reason => PENDING_REASONS[reason]).filter(Boolean))];
  const outside = check.containment_status === 'conflict';
  const shortfall = edge && edge.status === 'conflict' ? Math.max(0, edge.shortfall_m ?? edge.required_m - edge.actual_m) : null;
  const instruction = status === 'conflict'
    ? outside ? 'Ajusta el polígono para que quede dentro del predio aportado.' : 'Reduce o mueve la propuesta para recuperar el retiro indicado.'
    : status === 'at_limit' ? 'No queda margen para ampliar hacia este lindero.'
      : status === 'within_reviewed_limits' ? 'Esta figura alcanza los retiros revisados. La revisión continúa siendo preliminar.'
        : reasons[0] || 'Confirma el predio, la implantación y los retiros aplicables del IRM para revisar esta figura.';
  return <div className={`setback-feedback is-${status}${compact ? ' is-compact' : ''}`} data-setback-status={status}>
    <div className="setback-feedback-heading">
      <span className="setback-feedback-icon" aria-hidden="true">{STATUS_ICONS[status]}</span>
      <div><span className="setback-feedback-eyebrow">{check.role === 'existing' ? 'HUELLA EXISTENTE · RETIROS' : 'AMPLIACIÓN · RETIROS'}</span>
        {!compact && check.label && <span className="setback-feedback-name">{check.label}</span>}
        <strong role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined} aria-atomic={live ? 'true' : undefined}>{title}</strong>
      </div>
    </div>
    {edge && <div className="setback-feedback-edge">
      <span>{setbackEdgeLabel(edge)}</span>
      <dl className="setback-feedback-values">
        <div><dt>Retiro mínimo</dt><dd>{setbackMeasure(edge.required_m)} <small>m</small></dd></div>
        <div><dt>{check.role === 'existing' ? 'Distancia actual' : 'Distancia propuesta'}</dt><dd>{setbackMeasure(edge.actual_m)} <small>m</small></dd></div>
        {shortfall !== null && <div className="setback-feedback-shortfall"><dt>Faltan</dt><dd>{setbackMeasure(shortfall)} <small>m</small></dd></div>}
      </dl>
    </div>}
    {(!compact || status === 'pending' || outside) && <p className="setback-feedback-instruction">{instruction}</p>}
    {!compact && live && <span className="setback-feedback-live">Vista previa geométrica</span>}
    {!compact && outside && typeof check.outside_parcel_m2 === 'number' && check.outside_parcel_m2 > 0 && <p className="setback-feedback-note">Área fuera del predio: <strong>{setbackMeasure(check.outside_parcel_m2)} m²</strong>.</p>}
    {!compact && conflicts.length > 1 && <details className="setback-feedback-details"><summary>{conflicts.length} linderos con conflicto</summary>
      <ul>{conflicts.map(item => <li key={`${item.polygon}:${item.ring}:${item.edge}`}><strong>{setbackEdgeLabel(item)}</strong>
        <span>{setbackMeasure(item.actual_m)} m propuestos · mínimo {setbackMeasure(item.required_m)} m</span></li>)}</ul>
    </details>}
    {!compact && reasons.length > 0 && status !== 'pending' && <p className="setback-feedback-note">Revisión parcial. {reasons.join(' ')}</p>}
    {!compact && status === 'pending' && reasons.length > 1 && <ul className="setback-feedback-pending">{reasons.slice(1).map(reason => <li key={reason}>{reason}</li>)}</ul>}
  </div>;
}
