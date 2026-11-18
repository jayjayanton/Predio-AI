// Extraction counts describe observed source instances, not drawing coverage.
const entityLabels = {
  LINE: 'líneas',
  LWPOLYLINE: 'polilíneas ligeras',
  POLYLINE: 'polilíneas',
  INSERT: 'bloques CAD',
  ARC: 'arcos',
  CIRCLE: 'círculos',
  ELLIPSE: 'elipses',
  SPLINE: 'curvas spline',
  TEXT: 'textos',
  MTEXT: 'textos multilínea',
  DIMENSION: 'cotas',
  HATCH: 'tramas',
  SOLID: 'rellenos',
  '3DFACE': 'caras 3D',
  IMAGE: 'imágenes',
  POINT: 'puntos',
};

const positiveCount = value => Number.isSafeInteger(value) && value > 0;
const formatCount = value => value.toLocaleString('es-EC');
const observedOmissions = extraction => Object.entries(extraction?.omitted_entity_counts || {})
  .filter(([, count]) => positiveCount(count));

export function hasPartialExtraction(extraction) {
  return Boolean(extraction && (
    extraction.status === 'partial'
    || extraction.limit_reached
    || extraction.traversal_limit_reached
    || extraction.depth_limit_reached
    || extraction.source_label_limit_reached
    || positiveCount(extraction.omitted_curved_polylines)
    || positiveCount(extraction.omitted_nonempty_layouts)
    || observedOmissions(extraction).length
  ));
}

export function drawingExtractionMessages(extraction) {
  if (!hasPartialExtraction(extraction)) return [];
  const messages = [];
  if (Number.isSafeInteger(extraction.rendered_primitives) && extraction.rendered_primitives >= 0) {
    messages.push(`Elementos extraídos para el visor: ${formatCount(extraction.rendered_primitives)}.`);
  }
  if (extraction.limit_reached) {
    const limit = positiveCount(extraction.primitive_limit)
      ? ` de ${formatCount(extraction.primitive_limit)} elementos` : '';
    messages.push(`Se alcanzó el límite de visualización${limit}; parte de la geometría no se muestra.`);
  }
  const omissions = observedOmissions(extraction);
  if (omissions.length) {
    messages.push(`Omisiones detectadas por tipo: ${omissions
      .map(([type, count]) => `${entityLabels[type] || type}: ${formatCount(count)}`).join('; ')}.`);
  }
  if (positiveCount(extraction.omitted_curved_polylines)) {
    messages.push(`Entre las polilíneas omitidas, ${formatCount(extraction.omitted_curved_polylines)} contienen curvas. No se sustituyeron por líneas rectas.`);
  }
  if (extraction.traversal_limit_reached || extraction.depth_limit_reached) {
    messages.push('La revisión de entidades o bloques se detuvo por un límite de procesamiento. Puede haber más omisiones sin contar.');
  }
  if (positiveCount(extraction.omitted_nonempty_layouts)) {
    messages.push(`Presentaciones CAD con contenido que no se incluyen: ${formatCount(extraction.omitted_nonempty_layouts)}. Esta vista corresponde al espacio modelo.`);
  }
  if (extraction.source_label_limit_reached) {
    const labelLimit = positiveCount(extraction.source_label_limit) ? formatCount(extraction.source_label_limit) : 'establecido';
    messages.push(`Se alcanzó el límite de ${labelLimit} etiquetas originales; pueden faltar textos o cotas.`);
  }
  return messages;
}

export function dwgConversionNotice(blueprint) {
  const conversion = blueprint?.conversion;
  if (blueprint?.format !== 'dwg'
      || !['converted', 'converted_with_warnings'].includes(conversion?.status)) return null;
  const hasWarnings = conversion.status === 'converted_with_warnings'
    || conversion.converter_reported_warnings === true
    || conversion.diagnostics_truncated === true;
  return {
    title: hasWarnings ? 'DWG convertido con avisos.' : 'DWG convertido para inspección.',
    detail: 'La conversión requiere revisión con el archivo original. La vista puede ser parcial.',
  };
}
