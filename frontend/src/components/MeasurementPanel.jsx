import React, { useEffect, useId, useMemo, useState } from 'react';
import { UNIT_OPTIONS, cadUnitFromCode, calibrateScale, deriveScaleFromUnit, measureSelection } from '../drawingMeasurements.js';
import { canConfirmDrawingUnit, formatDrawingNumber, formatScaleFactor, parseKnownMetres } from '../measurementPresentation.js';

const AREA_REASONS = {
  no_geometry: 'Selecciona una línea para conocer su longitud o un contorno cerrado para obtener un área.',
  invalid_geometry: 'Parte de la geometría seleccionada no es válida para calcular un área. Revisa los elementos excluidos.',
  open_path: 'El trazado está abierto. Selecciona un contorno cerrado para obtener un área y su perímetro.',
  branching: 'La selección tiene ramificaciones. Selecciona solo los trazos de un contorno continuo.',
  disconnected: 'Hay trazos desconectados. Selecciona un único contorno continuo.',
  multiple_contours: 'Hay varios contornos independientes. Selecciona uno para calcular su área por separado.',
  duplicate_edges: 'Hay trazos duplicados o superpuestos. Revisa la selección antes de calcular un área.',
  self_intersection: 'El contorno se cruza a sí mismo; no se calcula un área para esa selección.',
  overlapping_rings: 'Los contornos se cruzan o superponen. Selecciona una frontera sin ambigüedades.',
  degenerate: 'El contorno no encierra una superficie utilizable.',
  complexity_limit: 'La selección es demasiado compleja para comprobar su área. Selecciona un contorno más sencillo.',
  numerical_range: 'Las coordenadas no permiten obtener un resultado numérico confiable.',
};
const EXCLUDED_LABELS = {
  text: 'textos y etiquetas', dimension: 'componentes de cotas', hatchPattern: 'trazos de trama',
  invalid: 'geometría no válida', unsupported: 'geometría no compatible', degenerate: 'trazos sin longitud',
};
const METRICS = [
  {key: 'length', label: 'Longitud sumada', metricUnit: 'm', rawUnit: 'u'},
  {key: 'perimeter', label: 'Perímetro cerrado', metricUnit: 'm', rawUnit: 'u'},
  {key: 'area', label: 'Área encerrada', metricUnit: 'm²', rawUnit: 'u²'},
];

export default function MeasurementPanel({
  elements, hiddenSelectedCount = 0, documentFormat, unitsCode, scope, viewIdentity,
  scale, onScaleChange, onClearSelection, onReturnToDrawing, panelId, sectionRef,
}) {
  const ownId = useId();
  const knownInputId = `${ownId}-known`;
  const knownHelpId = `${ownId}-known-help`;
  const errorId = `${ownId}-error`;
  const unitAllowed = canConfirmDrawingUnit(documentFormat, scope);
  const declaredUnit = useMemo(() => cadUnitFromCode(unitsCode), [unitsCode]);
  const suggestedUnit = unitAllowed && declaredUnit && UNIT_OPTIONS.some(option => option.value === declaredUnit.unit)
    ? declaredUnit.unit : '';
  const [unitChoice, setUnitChoice] = useState(suggestedUnit);
  const [knownMetres, setKnownMetres] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showScaleEditor, setShowScaleEditor] = useState(true);
  const result = useMemo(() => measureSelection(elements, {metresPerUnit: scale?.metresPerUnit ?? null}), [elements, scale?.metresPerUnit]);
  const hasGeometry = result.eligibleCount > 0;
  const excluded = Object.entries(result.excluded || {}).filter(([, count]) => count > 0);
  const hasCurveApproximation = result.warnings?.includes('curve_approximation');
  const calibrationEligible = result.calibration?.eligible === true;
  const metricRangeError = result.metricReason === 'numerical_range' || result.warnings?.includes('metric_numerical_range');
  const scaleFactor = scale ? formatScaleFactor(scale.metresPerUnit) : null;

  useEffect(() => {
    setUnitChoice(suggestedUnit); setKnownMetres(''); setError(''); setNotice(''); setShowScaleEditor(true);
  }, [viewIdentity, suggestedUnit]);
  useEffect(() => { setKnownMetres(''); setError(''); }, [elements]);

  const applyUnit = event => {
    event.preventDefault();
    const factor = deriveScaleFromUnit(unitChoice);
    if (!unitAllowed || !Number.isFinite(factor) || factor <= 0) { setError('Elige una unidad válida antes de aplicarla.'); return; }
    onScaleChange({metresPerUnit: factor, method: 'unit', unit: unitChoice});
    setError(''); setNotice('Unidad confirmada por ti y aplicada solo a esta vista.'); setShowScaleEditor(false);
  };
  const applyCalibration = event => {
    event.preventDefault();
    const known = parseKnownMetres(knownMetres);
    if (known === null) { setError('Escribe una longitud conocida mayor que cero, en metros. Puedes usar coma decimal, por ejemplo 3,10.'); return; }
    const calibration = calibrateScale(elements, known);
    if (!calibration.ok) {
      setError(calibration.reason === 'numerical_range'
        ? 'La longitud indicada produce una escala demasiado grande o pequeña. Revisa el valor y el trazado de referencia.'
        : 'Selecciona un único trazado válido con longitud mayor que cero para usarlo como referencia.');
      return;
    }
    const {ok, ...confirmedScale} = calibration;
    onScaleChange(confirmedScale);
    setError(''); setNotice('Escala calibrada con la longitud que indicaste; se aplica solo a esta vista.'); setShowScaleEditor(false);
  };
  const reset = () => {
    onScaleChange(null); setKnownMetres(''); setUnitChoice(suggestedUnit); setError('');
    setNotice('Escala restablecida. Los resultados vuelven a unidades del dibujo.'); setShowScaleEditor(true);
  };

  return <section id={panelId} ref={sectionRef} className="cad-measurements" tabIndex={-1} aria-labelledby={`${ownId}-title`}>
    <div className="cad-measurement-heading"><h3 id={`${ownId}-title`}>Medidas</h3><span className={scale ? 'is-confirmed' : ''}>{scale ? 'Escala aplicada' : 'Escala pendiente'}</span></div>
    <div className="cad-measurement-scope">
      <p><strong>{elements.length.toLocaleString('es-EC')}</strong> {elements.length === 1 ? 'elemento seleccionado' : 'elementos seleccionados'}<br />
        {result.eligibleCount.toLocaleString('es-EC')} {result.eligibleCount === 1 ? 'elemento compatible' : 'elementos compatibles'} · {result.excludedCount.toLocaleString('es-EC')} {result.excludedCount === 1 ? 'excluido' : 'excluidos'}</p>
      <div className="cad-measurement-actions">
        {onReturnToDrawing && <button type="button" onClick={onReturnToDrawing}>Volver al plano</button>}
        {elements.length > 0 && <button type="button" onClick={onClearSelection}>Limpiar</button>}
      </div>
    </div>
    {excluded.length > 0 && <p className="cad-measurement-excluded"><strong>{result.excludedCount.toLocaleString('es-EC')} {result.excludedCount === 1 ? 'excluido' : 'excluidos'}:</strong> {excluded.map(([kind, count]) => `${EXCLUDED_LABELS[kind] || 'otros elementos'} (${count.toLocaleString('es-EC')})`).join('; ')}. No se suman a las medidas.</p>}
    {hiddenSelectedCount > 0 && <p className="cad-measurement-hidden">La selección incluye <strong>{hiddenSelectedCount.toLocaleString('es-EC')} {hiddenSelectedCount === 1 ? 'elemento oculto' : 'elementos ocultos'}</strong>; {hiddenSelectedCount === 1 ? 'también se considera' : 'también se consideran'}, con las exclusiones indicadas.</p>}
    <div className="cad-measurement-values" aria-live="polite" aria-atomic="true">
      {METRICS.map(({key, label, metricUnit, rawUnit}) => {
        const value = hasGeometry ? (scale ? result.metric?.[key] : result.raw?.[key]) : null;
        const available = Number.isFinite(value);
        const approximate = result.approximate?.[key] || (scale && scale.approximate);
        return <div key={key} className={`cad-measurement-value cad-measurement-${key}`}><span>{label}</span>
          <strong>{available && approximate ? '≈ ' : ''}{formatDrawingNumber(value)}{available && <small>{scale ? metricUnit : rawUnit}</small>}</strong>
          {scale && hasGeometry && Number.isFinite(result.raw?.[key]) && <small>{formatDrawingNumber(result.raw[key])} {rawUnit} del dibujo</small>}
        </div>;
      })}
    </div>
    {!scale && <p className="cad-measurement-next">u = unidades del dibujo. {unitAllowed ? 'Aplica una unidad o calibra una referencia para obtener m y m².' : 'Calibra una longitud conocida para obtener m y m².'}</p>}
    {scale && metricRangeError && <p className="cad-measurement-error" role="status">La escala aplicada produce cantidades demasiado grandes o pequeñas para representarlas de forma confiable. Se conservan los valores en unidades del dibujo; restablece la escala y revisa la unidad o la referencia.</p>}
    {hasGeometry && <p className="cad-length-scope">La longitud suma los trazados compatibles seleccionados. Los trazados coincidentes cuentan por separado; no equivale a cantidades de obra.</p>}
    {result.areaMode === 'compound_rings' && elements.some(item => item.rings?.length > 1) && <p className="cad-length-scope">El área descuenta los huecos interiores del contorno. El perímetro incluye el borde exterior y los bordes de esos huecos.</p>}
    {result.areaStatus !== 'available' && <p className="cad-area-reason">{AREA_REASONS[result.areaReason] || 'No se puede determinar un área para esta selección. Selecciona un único contorno cerrado y continuo.'}</p>}
    {hasCurveApproximation && <p className="cad-measurement-approximation">La selección contiene curvas representadas por tramos. Sus longitudes y áreas son aproximadas.</p>}
    {result.warnings?.includes('roundoff_endpoint_matching') && <p className="cad-measurement-approximation">El cierre utiliza extremos coincidentes dentro de una tolerancia numérica. Revisa el contorno seleccionado.</p>}
    {scale ? <div className="cad-scale-current">
      <p><strong>{scale.method === 'known_length' ? 'Calibración con referencia' : 'Unidad confirmada por ti'}</strong><br />1 u {scaleFactor.approximate ? '≈' : '='} {scaleFactor.text} m.</p>
      {scale.method === 'known_length' && <p>Referencia: <span className="cad-reference-id">{scale.referenceElementId}</span><br />{formatDrawingNumber(scale.referenceLengthDrawingUnits)} u = {formatDrawingNumber(scale.knownLengthMetres)} m.</p>}
      <div className="cad-scale-actions"><button type="button" onClick={() => setShowScaleEditor(value => !value)} aria-expanded={showScaleEditor}>{showScaleEditor ? 'Cerrar ajustes' : 'Cambiar escala'}</button><button type="button" onClick={reset}>Restablecer escala</button></div>
    </div> : null}
    {showScaleEditor && <div className="cad-scale-editor">
      {unitAllowed ? <form onSubmit={applyUnit} className="cad-unit-form">
        <label>Unidad del dibujo<select value={unitChoice} onChange={event => { setUnitChoice(event.target.value); setError(''); }} aria-label="Unidad del dibujo">
          <option value="">Seleccionar unidad…</option>{UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        {declaredUnit ? <p>El archivo declara {declaredUnit.label.toLocaleLowerCase('es')}. Es una sugerencia; no se aplica hasta que la confirmes.</p> : <p>No hay una unidad utilizable confirmada en los datos del archivo. Elígela si la conoces o usa una longitud de referencia.</p>}
        <button type="submit" disabled={!unitChoice}>Aplicar unidad</button>
      </form> : <p className="cad-calibration-only">{documentFormat === 'pdf' ? 'En PDF, las coordenadas de la página no indican metros reales.' : 'Esta presentación necesita su propia referencia de escala.'} Calibra con una longitud conocida; no se aplica la unidad del espacio modelo.</p>}
      <form onSubmit={applyCalibration} className="cad-calibration-form">
        <h4>Calibrar con una longitud conocida</h4>
        {calibrationEligible ? <p>Referencia seleccionada: <span className="cad-reference-id">{result.calibration.referenceElementId}</span><br />Longitud del trazado: {formatDrawingNumber(result.calibration.lengthDrawingUnits)} u.</p>
          : <p>Selecciona un único trazado válido para usarlo como referencia. No uses un texto de cota, un relleno con varios contornos ni los trazos de una trama.</p>}
        {calibrationEligible && result.calibration.approximate && <p>La referencia incluye una curva aproximada; esa aproximación también afecta a la escala.</p>}
        <label htmlFor={knownInputId}>Longitud conocida (m)</label>
        <input id={knownInputId} type="text" inputMode="decimal" value={knownMetres} disabled={!calibrationEligible}
          onChange={event => { setKnownMetres(event.target.value); setError(''); }} placeholder="Ej.: 3,10"
          aria-describedby={`${knownHelpId}${error ? ` ${errorId}` : ''}`} aria-invalid={Boolean(error)} />
        <p id={knownHelpId}>Indica la longitud total del trazado seleccionado, no solo la distancia entre sus extremos.</p>
        <button type="submit" disabled={!calibrationEligible}>Aplicar calibración</button>
      </form>
    </div>}
    {error && <p id={errorId} className="cad-measurement-error" role="alert">{error}</p>}
    {notice && <p className="cad-measurement-notice" role="status">{notice}</p>}
    <p className="cad-measurement-boundary">{scale ? 'Estimaciones geométricas con la escala que confirmaste; no son medidas verificadas para obra.' : 'La escala necesita confirmación antes de expresar resultados en metros.'} El área corresponde al contorno elegido; no identifica automáticamente una habitación.</p>
    {(scale?.method === 'known_length' || !unitAllowed) && <p className="cad-measurement-boundary">Usa esta escala solo en elementos que compartan la escala de la referencia. Si hay detalles o ventanas con otra escala, vuelve a calibrar.</p>}
    <p className="cad-measurement-source">Los valores escritos en el plano son anotaciones de origen. No se usan para calibrar ni para calcular automáticamente estas medidas.</p>
  </section>;
}
