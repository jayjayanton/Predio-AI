import React from 'react';
import {removeProjectSelection, summarizeProjectSelections} from '../projectMeasurements.js';

const format = (number, units) => Number.isFinite(number)
  ? `${number.toLocaleString('es-EC', {maximumFractionDigits: 3})} ${units}` : 'Pendiente';

export default function ProjectSelections({records = [], onRemove, onClear}) {
  const rooms = summarizeProjectSelections(records);
  const exportReport = () => {
    const payload = {schema: 'predioai.project_selections.v1', qualification: 'Mediciones orientativas; relaciones y escalas confirmadas por el usuario. No es un levantamiento verificado.',
      rooms, selections: records};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'predioai-selecciones-proyecto.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="project-selections" aria-label="Selecciones del proyecto" style={{marginTop:20}}>
    <div className="section-heading">SELECCIONES DEL PROYECTO <span>ESTUDIO ORIENTATIVO</span></div>
    <h3>Medidas combinadas entre planos</h3>
    <p className="note">Selecciona un contorno de planta o una línea vertical de un corte, confirma la escala de cada vista y pulsa «Añadir a proyecto» en el visor. Agrupa las mediciones con el mismo nombre de habitación. Las asociaciones entre archivos las confirma el usuario.</p>
    {!records.length ? <p className="note">Todavía no hay mediciones guardadas. Abre «Medidas» en el dibujo y añade una selección.</p>
      : <>{rooms.map(room => <article key={room.room} style={{border:'1px solid #9baba9',borderRadius:10,padding:12,marginBottom:12}}>
        <h4>{room.room}</h4>
        <p><strong>Superficie:</strong> {format(room.floorArea,'m²')} · <strong>Altura:</strong> {format(room.height,'m')}</p>
        <p><strong>Perímetro:</strong> {format(room.perimeter,'m')} · <strong>Volumen:</strong> {format(room.volume,'m³')}</p>
        {room.volume !== null
          ? <p className="note">Volumen = superficie de planta × altura, suponiendo piso y techo horizontales y altura uniforme. No se descuentan muebles, vanos ni instalaciones.</p>
          : <p className="note" role="status">Volumen pendiente: se requiere exactamente un contorno de superficie y una altura correspondiente, ambos calibrados. Si hay alturas variables, hacen falta geometría y referencias espaciales adicionales para integrar la altura.</p>}
        {room.ambiguous && <p className="note">Hay varias selecciones del mismo tipo. Elige cuál representa la habitación antes de calcular un volumen.</p>}
        {room.approximate && <p className="note">Al menos una geometría proviene de una aproximación de curva.</p>}
        <ul>{room.items.map(item => <li key={item.id}>
          {item.kind === 'floor_area' ? 'Superficie' : 'Altura'}: {format(item.value,item.kind === 'floor_area' ? 'm²' : 'm')}
          {' · '}{item.source}{item.view ? ' · '+item.view : ''}
          {' '}<button type="button" onClick={() => onRemove(item.id)}>Quitar medición</button>
        </li>)}</ul>
      </article>)}
      <button type="button" onClick={exportReport}>Exportar reporte JSON</button>
      {' '}<button type="button" onClick={onClear}>Limpiar selecciones del proyecto</button>
      </>}
    <p className="note">Los archivos no se convierten automáticamente en un modelo 3D. Un corte solo muestra las paredes que atraviesa. El estudio permanece en esta sesión; exporta los resultados antes de cerrar la página.</p>
  </section>;
}
