/** A fictional drawing for exploring the viewer without uploading a file. */
export function createExampleDrawing() {
  const elements = [];
  const sourceLabels = [];
  const add = (layer, points, extra = {}) => {
    const id = `example-${elements.length + 1}`;
    elements.push({ id, kind: 'polyline', points, layer, page: 1,
      source: 'synthetic_example', source_handle: id, block_path: [],
      classification: 'unclassified', ...extra });
  };
  const line = (layer, a, b, extra = {}) => add(layer, [a, b], { kind: 'line', source_type: 'LINE', ...extra });
  const rect = (layer, x, y, width, height) => add(layer,
    [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]],
    { closed: true });
  const arc = (layer, x, y, radius, start, end) => add(layer,
    Array.from({ length: 25 }, (_, i) => {
      const angle = (start + (end - start) * i / 24) * Math.PI / 180;
      return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
    }), { kind: 'curve', approximated: true, source_type: 'ARC' });
  const label = (text, x, y, layer = 'Textos del ejemplo', kind = 'source_text') => {
    const id = `example-label-${sourceLabels.length + 1}`;
    sourceLabels.push({ id, text, position: [x, y], layer, kind,
      source_type: 'TEXT', source_handle: id, block_path: [],
      text_height: 15, rotation: 0, verified: false, source: 'synthetic_example' });
  };
  const walls = 'Muros del ejemplo';
  const doors = 'Puertas del ejemplo';
  const furniture = 'Mobiliario del ejemplo';
  const floor = 'Trama de piso';

  // Room-sized tile grids make layer and area selection easy to explore.
  for (const [x, y, width, height] of [[108, 108, 442, 244], [582, 108, 410, 244],
    [108, 384, 442, 288], [582, 384, 410, 288]]) {
    for (let px = x; px <= x + width; px += 28) line(floor, [px, y], [px, y + height], {hatch_pattern: true, source_type: 'HATCH'});
    for (let py = y; py <= y + height; py += 28) line(floor, [x, py], [x + width, py], {hatch_pattern: true, source_type: 'HATCH'});
  }
  rect(walls, 88, 88, 924, 604);
  rect(walls, 104, 104, 892, 572);
  // Interior partitions with deliberate door openings.
  for (const x of [552, 568]) {
    line(walls, [x, 104], [x, 260]);
    line(walls, [x, 330], [x, 676]);
  }
  for (const y of [354, 370]) {
    line(walls, [104, y], [180, y]);
    line(walls, [250, y], [552, y]);
    line(walls, [568, y], [800, y]);
    line(walls, [870, y], [996, y]);
  }
  line(doors, [552, 260], [482, 260]);
  arc(doors, 552, 260, 70, 90, 180);
  line(doors, [180, 370], [180, 440]);
  arc(doors, 180, 370, 70, 0, 90);
  line(doors, [870, 370], [870, 440]);
  arc(doors, 870, 370, 70, 90, 180);
  // Windows and fixtures are deliberately kept on their own layers.
  for (const [x, y, width] of [[210, 88, 170], [690, 88, 170], [230, 676, 170]]) {
    rect('Ventanas del ejemplo', x, y, width, 16);
    line('Ventanas del ejemplo', [x, y + 8], [x + width, y + 8]);
  }
  rect(furniture, 130, 135, 150, 180);
  rect(furniture, 140, 145, 62, 34);
  rect(furniture, 210, 145, 62, 34);
  rect(furniture, 410, 120, 110, 46);
  rect(furniture, 610, 122, 54, 196);
  rect(furniture, 664, 122, 284, 54);
  rect(furniture, 692, 132, 66, 34);
  for (const x of [820, 848]) for (const y of [139, 159]) arc(furniture, x, y, 8, 0, 360);
  rect(furniture, 142, 440, 64, 164);
  rect(furniture, 154, 452, 40, 140);
  rect(furniture, 270, 472, 104, 66);
  rect(furniture, 440, 450, 28, 146);
  rect(furniture, 620, 420, 100, 64);
  arc(furniture, 832, 506, 50, 0, 360);
  rect(furniture, 920, 424, 50, 100);

  label('DORMITORIO', 320, 225);
  label('10,78 m² · ejemplo', 320, 250, 'Cotas del ejemplo', 'source_area');
  label('COCINA', 760, 252);
  label('SALA', 290, 590);
  label('BAÑO / LAVADO', 716, 615);
  label('VIVIENDA FICTICIA · PARA PROBAR EL VISOR', 235, 760);
  line('Cotas del ejemplo', [88, 46], [1012, 46], {dimension_handle: 'example-dimension'});
  for (const x of [88, 1012]) line('Cotas del ejemplo', [x, 32], [x, 76], {dimension_handle: 'example-dimension'});
  label('9,24 m · cota ficticia', 455, 34, 'Cotas del ejemplo', 'source_dimension');

  // Explicit fictional floor boundary: 442 × 244 cm, separate from hatch strokes.
  // It can be selected by layer to demonstrate area/perimeter after unit confirmation.
  rect('Área de ejemplo', 108, 108, 442, 244);
  Object.assign(elements.at(-1), {source_type: 'LWPOLYLINE', measurement_demo: true});

  // Separate, explicitly fictional ground outline for the planning workflow.
  rect('Huella de ejemplo', 88, 88, 924, 604);
  Object.assign(elements.at(-1), {source_type: 'LWPOLYLINE', footprint_demo: true});

  return {
    filename: 'Vivienda de ejemplo · dibujo ficticio',
    format: 'example',
    units_code: 5,
    is_example: true,
    floor_identification: 'unverified',
    display_scope: 'example',
    cad_layouts: [{ name: 'Ejemplo', entity_count: elements.length + sourceLabels.length, displayed: true }],
    drawing_views: [{
      page: 1, name: 'Ejemplo', label: 'Vivienda de ejemplo',
      elements, source_labels: sourceLabels, bounds: [40, 0, 1060, 800],
      units_verified: false, measurements_available: false,
      extraction: {
        status: 'supported_geometry', scope: 'example',
        rendered_primitives: elements.length, rendered_source_labels: sourceLabels.length,
        omitted_entity_counts: {}, limit_reached: false,
        traversal_limit_reached: false, depth_limit_reached: false,
        omitted_nonempty_layouts: 0,
      },
    }],
  };
}
