import React from 'react';

export default function AnalyticsRoadmap({ onExplore, onSelection }) {
  return <section className="analytics-page" aria-labelledby="analytics-title">
    <div className="analytics-intro"><span className="eyebrow">VISIÓN DEL PRODUCTO · PRÓXIMA ETAPA</span><h1 id="analytics-title">De encontrar predios<br />a entender su potencial.</h1><p>La siguiente evolución de PredioAI conectará la evidencia territorial con un motor analítico de priorización y segmentación.</p><span className="phase-badge">En planificación · Sin puntuaciones activas</span></div>
    <div className="analytics-roadmap">
      <article><span className="roadmap-number">01</span><span className="phase-label available">Base disponible</span><h2>Reunir la evidencia</h2><p>Catastro, mapa, selección comparativa y consulta asistida del IRM. Una base para examinar cada predio y la procedencia de sus datos.</p><button type="button" className="text-button" onClick={onExplore}>Explorar la base actual →</button></article>
      <article><span className="roadmap-number">02</span><span className="phase-label">Próxima etapa</span><h2>Priorizar con criterio</h2><p>Un motor de scoring con variables, pesos y restricciones explícitos, adaptado al objetivo de cada proyecto.</p><ul><li>Desglose de los factores de la puntuación.</li><li>Calidad de datos y vacíos visibles.</li><li>Comparación bajo criterios consistentes.</li></ul></article>
      <article><span className="roadmap-number">03</span><span className="phase-label">Próxima etapa</span><h2>Descubrir patrones</h2><p>Aprendizaje no supervisado para explorar grupos de predios con características similares y entender sus diferencias territoriales.</p><ul><li>Segmentos definidos por datos observados.</li><li>Revisión de estabilidad y utilidad.</li><li>Interpretación junto a expertos locales.</li></ul></article>
    </div>
    <div className="analytics-principle"><div><span className="eyebrow">UNA DECISIÓN QUE SE PUEDE EXPLICAR</span><h2>La confianza viene de la evidencia.</h2></div><p>Las futuras puntuaciones deberán mostrar sus fuentes, criterios y límites. Un grupo de predios similares no demuestra rentabilidad; una buena puntuación tampoco reemplaza la revisión del proyecto.</p></div>
    <div className="analytics-pilot"><h2>El siguiente hito: un piloto con una inmobiliaria.</h2><p>Propuesta de validación: definir un caso de búsqueda, acordar criterios con el equipo y contrastar los predios seleccionados con su revisión profesional. Así se podrá medir utilidad, tiempo de revisión y calidad de la evidencia antes de escalar.</p><button type="button" className="secondary" onClick={onSelection}>Revisar mi selección →</button></div>
  </section>;
}
