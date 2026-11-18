import React, {useId, useMemo, useState} from 'react';
import {evaluateSetbackGeometry} from '../liveSetbacks.js';
import SetbackFeedback, {setbackMeasure} from './SetbackFeedback.jsx';
import './SetbackExample.css';

const CONTEXT = {
  version: 1, coordinate_space: 'local_metres', ready: true, complete: true, tolerance_m: 1e-6,
  parcel: {type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]},
  edges: [
    {polygon: 0, ring: 0, edge: 0, kind: 'front', required_m: 0, points: [[0, 0], [20, 0]]},
    {polygon: 0, ring: 0, edge: 1, kind: 'side', required_m: 5, points: [[20, 0], [20, 20]]},
    {polygon: 0, ring: 0, edge: 2, kind: 'rear', required_m: 0, points: [[20, 20], [0, 20]]},
    {polygon: 0, ring: 0, edge: 3, kind: 'side', required_m: 5, points: [[0, 20], [0, 0]]},
  ],
  pending_reasons: [],
};
const PALETTE = {
  within_reviewed_limits: {stroke: '#287152', fill: '#9dc5ab'},
  at_limit: {stroke: '#97651b', fill: '#efce86'},
  conflict: {stroke: '#af3441', fill: '#eca4af'},
};

/** A detached metric example: its fictitious rules never enter a project's data. */
export default function SetbackExample() {
  const [length, setLength] = useState(4);
  const id = useId().replaceAll(':', '');
  const geometry = useMemo(() => ({type: 'Polygon', coordinates: [[[10, 8], [10 + length, 8], [10 + length, 12], [10, 12], [10, 8]]]}), [length]);
  const check = useMemo(() => evaluateSetbackGeometry(geometry, CONTEXT, {id: 'setback-tutorial', role: 'extension', label: 'Ampliación de ejemplo'}), [geometry]);
  const palette = PALETTE[check.status] || PALETTE.within_reviewed_limits;
  return <details className="setback-example">
    <summary><span>Prueba cómo avisa un retiro</span><small>Ejemplo interactivo</small></summary>
    <div className="setback-example-body">
      <div className="setback-example-intro"><span className="setback-example-eyebrow">EJEMPLO FICTICIO · RETIRO LATERAL DE 5 m</span>
        <p>Alarga la ampliación hacia el lindero. El color y la distancia cambian con su tamaño.</p>
        <p className="setback-example-scope">Estos valores solo explican la herramienta; no se aplican a tu archivo.</p>
      </div>
      <div className="setback-example-grid">
        <div className="setback-example-visual">
          <svg viewBox="-1.5 -2.8 24.5 26" role="img" aria-label={`Ejemplo ficticio: ampliación de ${setbackMeasure(length)} metros, a ${setbackMeasure(10 - length)} metros del lindero; retiro mínimo de 5 metros.`}>
            <defs><pattern id={`${id}-grid`} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 H 0 V 1" fill="none" stroke="#dbe5dd" strokeWidth=".035"/></pattern>
              <pattern id={`${id}-strip`} width=".8" height=".8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".8" height=".8" fill="#fcf2dc"/><path d="M 0 0 V .8" stroke="#e7d4a7" strokeWidth=".09"/></pattern>
            </defs>
            <rect width="20" height="20" fill={`url(#${id}-grid)`}/>
            <rect x="15" width="5" height="20" fill={`url(#${id}-strip)`}/>
            <rect width="20" height="20" fill="none" stroke="#536c87" strokeWidth=".16"/>
            <line x1="15" y1="0" x2="15" y2="20" stroke="#ae7f35" strokeWidth=".12" strokeDasharray=".4 .3"/>
            <rect x="5" y="7" width="5" height="6" fill="#dce9e0" stroke="#48735b" strokeWidth=".14"/>
            <text x="7.5" y="9.7" textAnchor="middle" fill="#3e654e" fontSize=".65">Huella</text><text x="7.5" y="10.6" textAnchor="middle" fill="#3e654e" fontSize=".65">existente</text>
            <path data-example-shape="extension" data-setback-status={check.status} d={`M10 8 H${10 + length} V12 H10 Z`} fill={palette.fill} fillOpacity=".85" stroke={palette.stroke} strokeWidth=".18" strokeDasharray=".45 .2"/>
            <line x1={10 + length} y1="13.6" x2="20" y2="13.6" stroke={palette.stroke} strokeWidth=".09"/>
            <path d={`M${10 + length} 13.25 V13.95 M20 13.25 V13.95`} fill="none" stroke={palette.stroke} strokeWidth=".09"/>
            <text x={(30 + length) / 2} y="14.7" textAnchor="middle" fill={palette.stroke} fontSize=".68" fontWeight="600">{setbackMeasure(10 - length)} m libres</text>
            <text x="5" y="16.8" fill="#526a59" fontSize=".65">Ampliación: {setbackMeasure(length)} m</text>
            <text x="17.5" y="-1.5" textAnchor="middle" fill="#8a642e" fontSize=".65">Retiro 5 m</text>
            <path d="M15 -.55 V-.95 M15 -.75 H20 M20 -.55 V-.95" fill="none" stroke="#9e793e" strokeWidth=".08"/>
            <text x="21.1" y="10" textAnchor="middle" fill="#536c87" fontSize=".65" transform="rotate(90 21.1 10)">Lindero del predio</text>
            <text x="10" y="21.5" textAnchor="middle" fill="#758279" fontSize=".6">Predio ficticio · 20 × 20 m · cuadrícula de 1 m</text>
          </svg>
        </div>
        <div className="setback-example-controls">
          <label htmlFor={`${id}-length`}>Longitud de la ampliación <output htmlFor={`${id}-length`}>{setbackMeasure(length)} m</output></label>
          <input id={`${id}-length`} type="range" min="0.5" max="7" step="0.1" value={length} aria-label="Longitud de la ampliación de ejemplo, en metros" onChange={event => setLength(Number(event.target.value))}/>
          <div className="setback-example-presets" aria-label="Situaciones del ejemplo">{[[4, 'Con margen'], [5, 'En el límite'], [6, 'Invade el retiro']].map(([value, label]) =>
            <button type="button" key={value} aria-label={`Ejemplo de ${value} m: ${label.toLowerCase()}`} aria-pressed={length === value} onClick={() => setLength(value)}><strong>{value} m</strong><span>{label}</span></button>)}</div>
          <SetbackFeedback check={check} live/>
          <p className="setback-example-scope">En tu proyecto, el aviso se activa con el predio, la implantación y el retiro del IRM revisados.</p>
        </div>
      </div>
    </div>
  </details>;
}
