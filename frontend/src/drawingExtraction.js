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
  VIEWPORT: 'ventanas de presentación',
  ATTRIB: 'atributos de bloque',
  ATTDEF: 'definiciones de atributo',
  MPOLYGON: 'polígonos con trama',
};

const reasonLabels = {
  external_reference_not_loaded: 'Referencias externas que no están incorporadas al archivo',
  clipped_block_not_rendered: 'Bloques recortados que no se representaron',
  paper_viewport_contents_not_rendered: 'Ventanas de presentación cuyo contenido no se proyectó',
  unsupported_entity_type: 'Entidades de un tipo aún no compatible',
  unsupported_3d_mesh: 'Mallas 3D no representadas',
  nonplanar_or_invalid_coordinates: 'Geometría fuera del plano XY o con coordenadas no válidas',
  nonplanar_or_invalid_text_transform: 'Textos con ubicación fuera del plano XY o transformación no válida',
  gradient_fill_not_rendered: 'Degradados no representados; se conservan sus contornos',
  missing_hatch_pattern: 'Tramas sin patrón disponible; se conservan sus contornos',
  polyline_width_not_rendered: 'Polilíneas cuyo ancho original no se representa',
  recursive_block_reference: 'Bloques con referencias circulares',
  missing_block_definition: 'Bloques cuya definición falta en el archivo',
  invalid_block_transform: 'Bloques con una transformación no válida',
  block_expansion_failed: 'Bloques que no pudieron expandirse por completo',
  dimension_geometry_missing: 'Cotas sin geometría disponible',
  dimension_components_unavailable: 'Cotas con componentes no disponibles',
  dimension_expansion_failed: 'Cotas que no pudieron representarse por completo',
  geometry_conversion_failed: 'Entidades cuya geometría no pudo convertirse',
  empty_or_degenerate_geometry: 'Entidades vacías o degeneradas',
  empty_hatch_boundaries: 'Tramas sin contorno válido',
  empty_text: 'Textos vacíos',
  invalid_text_height: 'Textos con altura no válida',
  invalid_text_control_characters: 'Textos con caracteres de control no compatibles',
};

const positiveCount = value => Number.isSafeInteger(value) && value > 0;
const formatCount = value => value.toLocaleString('es-EC');
const observedOmissions = extraction => Object.entries(extraction?.omitted_entity_counts || {})
  .filter(([, count]) => positiveCount(count));
const positiveEntries = value => Object.entries(value || {}).filter(([, count]) => positiveCount(count));

export function hasPartialExtraction(extraction) {
  return Boolean(extraction && (
    extraction.status === 'partial'
    || extraction.limit_reached
    || extraction.traversal_limit_reached
    || extraction.depth_limit_reached
    || (extraction.source_label_limit_reached && extraction.source_label_summary_only !== true)
    || positiveCount(extraction.omitted_curved_polylines)
    || positiveCount(extraction.omitted_nonempty_layouts)
    || observedOmissions(extraction).length
    || positiveEntries(extraction.partially_rendered_entity_counts).length
    || positiveEntries(extraction.omission_reasons).length
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
  const incomplete = positiveEntries(extraction.partially_rendered_entity_counts);
  if (incomplete.length) {
    messages.push(`Entidades representadas parcialmente: ${incomplete.map(([type, count]) => `${entityLabels[type] || type}: ${formatCount(count)}`).join('; ')}.`);
  }
  for (const [reason, count] of positiveEntries(extraction.omission_reasons)) {
    messages.push(`${reasonLabels[reason] || 'Otras limitaciones de importación'}: ${formatCount(count)}.`);
  }
  if (positiveCount(extraction.unexpanded_container_instances)) {
    messages.push(`No se pudo examinar el contenido de ${formatCount(extraction.unexpanded_container_instances)} bloques o contenedores. Los recuentos no incluyen sus entidades internas desconocidas.`);
  }
  if (positiveCount(extraction.omitted_curved_polylines)) {
    messages.push(`Entre las polilíneas omitidas, ${formatCount(extraction.omitted_curved_polylines)} contienen curvas. No se sustituyeron por líneas rectas.`);
  }
  if (extraction.traversal_limit_reached || extraction.depth_limit_reached) {
    messages.push('La revisión de entidades o bloques se detuvo por un límite de procesamiento. Puede haber más omisiones sin contar.');
  }
  if (positiveCount(extraction.omitted_nonempty_layouts)) {
    messages.push(`Presentaciones CAD con contenido que no se incluyen: ${formatCount(extraction.omitted_nonempty_layouts)}. Revisa las vistas disponibles del archivo.`);
  }
  if (extraction.source_label_limit_reached && extraction.source_label_summary_only !== true) {
    const labelLimit = positiveCount(extraction.source_label_limit) ? formatCount(extraction.source_label_limit) : 'establecido';
    messages.push(`Se alcanzó el límite de ${labelLimit} etiquetas originales; pueden faltar textos o cotas.`);
  }
  return messages;
}

export function drawingRepresentationMessages(extraction) {
  if (!extraction) return [];
  const messages = [];
  const textTypes = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);
  const approximations = positiveEntries(extraction.approximated_entity_counts);
  const curves = approximations.filter(([type]) => !textTypes.has(type));
  if (curves.length) {
    messages.push(`Curvas aproximadas para visualización (${curves.map(([type, count]) => `${entityLabels[type] || type}: ${formatCount(count)}`).join('; ')}). Sus tramos son una representación gráfica; no son segmentos rectos originales ni medidas verificadas.`);
  }
  if (positiveCount(extraction.rendered_text_elements) || approximations.some(([type]) => textTypes.has(type))) {
    messages.push('Los textos conservan el contenido del archivo con una fuente sustituta; la tipografía, el ajuste de líneas y el formato pueden diferir del CAD original.');
  }
  if (Array.isArray(extraction.rendering_limitations) && extraction.rendering_limitations.length) {
    messages.push('Se muestra geometría plana en XY. Los colores, grosores y tipos de línea originales pueden diferir; no se reconstruyen vistas 3D ni ventanas de presentación.');
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
