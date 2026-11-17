import React from 'react';
import '../styles/overview.css';

function Arrow({ diagonal = false }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function TerritoryIllustration() {
  return <figure className="po-territory" aria-labelledby="po-territory-caption">
    <div className="po-territory-heading"><span>Una perspectiva del territorio</span><span className="po-territory-coordinate" aria-hidden="true">Q / DMQ</span></div>
    <svg className="po-territory-svg" viewBox="0 0 580 430" role="img" aria-labelledby="po-map-title po-map-description">
      <title id="po-map-title">Ilustración conceptual de parcelas y su entorno</title>
      <desc id="po-map-description">Una trama de parcelas junto a una vía y un corredor natural. Una parcela está seleccionada para representar la relación entre el mapa y su ficha. Es una ilustración, no cartografía de un predio real.</desc>
      <defs>
        <pattern id="po-map-grid" width="29" height="29" patternUnits="userSpaceOnUse"><path d="M29 0H0v29" fill="none" stroke="#d9dfd5" strokeWidth=".6" /></pattern>
        <pattern id="po-map-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0v8" stroke="#88a78e" strokeWidth="1" /></pattern>
        <clipPath id="po-map-clip"><rect x="0" y="0" width="580" height="430" rx="0" /></clipPath>
      </defs>
      <g clipPath="url(#po-map-clip)">
        <rect width="580" height="430" fill="#e9eee6" />
        <rect width="580" height="430" fill="url(#po-map-grid)" />
        <path d="M435-30c-59 58-101 88-76 145s102 78 104 133-37 94-12 212h163V-30Z" fill="#dce7d7" />
        <path d="M445-30c-59 58-101 88-76 145s102 78 104 133-37 94-12 212h163V-30Z" fill="url(#po-map-hatch)" opacity=".5" />
        <g fill="none" stroke="#bacbb5" strokeWidth="1.1">
          <path d="M448-20c-64 74-67 101-33 145s92 74 91 137-26 104-12 178" />
          <path d="M471-20c-65 76-71 101-35 145s96 71 94 134-21 104-12 181" />
          <path d="M495-20c-64 74-72 98-39 141s100 75 99 137-20 106-12 182" />
          <path d="M521-20c-64 74-76 101-44 145s105 73 104 136" />
        </g>
        <path d="M-25 305 143 216 230 188 323 161 371 96 430-28" fill="none" stroke="#f9faf5" strokeWidth="28" strokeLinejoin="round" />
        <path d="M-25 305 143 216 230 188 323 161 371 96 430-28" fill="none" stroke="#c4cec1" strokeWidth="1.2" strokeDasharray="7 9" strokeLinejoin="round" />
        <path d="m143 216 69 242M230 188 175-20" fill="none" stroke="#f9faf5" strokeWidth="17" />
        <g fill="#f2f4ec" stroke="#a8b7a1" strokeWidth="1.3" strokeLinejoin="round">
          <path d="m-12 34 76-5 15 76-91 19Z" />
          <path d="m73 28 89-11 22 77-97 11Z" />
          <path d="m-12 133 92-19 15 74-107 57Z" />
          <path d="m88 114 99-12 21 76-105 35Z" />
          <path d="m192 16 82-9 15 71-77 17Z" />
          <path d="m284 7 90-13-39 83-37 2Z" />
          <path d="m215 103 74-15 22 64-75 23Z" />
          <path d="m300 88 30-2 34-4-40 62Z" />
          <path d="m-12 324 81-41 39 80-120 58Z" />
          <path d="m78 279 57-31 25 85-44 25Z" />
          <path d="m121 367 43-23 25 90-68 9Z" />
          <path d="m180 333 95-24 25 92-95 25Z" />
          <path d="m285 306 86-15 31 90-92 17Z" />
          <path d="m267 199 59-23 32 36 12 69-86 16Z" />
          <path d="m380 297 39-7 12 85-20 4Z" />
        </g>
        <path d="m158 240 87-33 27 90-94 24Z" fill="#b9d6ba" stroke="#225c43" strokeWidth="2.5" strokeLinejoin="round" />
        <g fill="#225c43"><circle cx="158" cy="240" r="3" /><circle cx="245" cy="207" r="3" /><circle cx="272" cy="297" r="3" /><circle cx="178" cy="321" r="3" /></g>
        <circle cx="215" cy="264" r="15" fill="#184e3a" />
        <path d="m209 264 4 4 8-9" fill="none" stroke="#f7f9ef" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M230 264h67l31-26h72" fill="none" stroke="#184e3a" strokeWidth="1.1" />
        <rect x="328" y="205" width="195" height="54" rx="4" fill="#fbfcf6" stroke="#cad5c5" />
        <circle cx="346" cy="224" r="3" fill="#225c43" />
        <text x="359" y="228" fill="#173e30" fontSize="12" fontWeight="600" fontFamily="system-ui, sans-serif">Parcela seleccionada</text>
        <text x="343" y="246" fill="#647667" fontSize="10" fontFamily="system-ui, sans-serif">Un punto de partida para evaluar</text>
        <g transform="translate(39 351)" fill="none" stroke="#4e6b55" strokeWidth="1.2"><path d="M0 25V0m-5 7 5-7 5 7" /><text x="-4" y="-10" fill="#4e6b55" stroke="none" fontSize="10" fontFamily="system-ui, sans-serif">N</text></g>
      </g>
    </svg>
    <figcaption id="po-territory-caption"><span>El mapa es el inicio. El contexto hace la diferencia.</span><small>Ilustración conceptual · sin datos de un predio real</small></figcaption>
  </figure>;
}

const steps = [
  { number: '01', title: 'Encuentra tu área de interés', text: 'Filtra por parroquia, superficie y características catastrales. Ubica los resultados directamente en el mapa.' },
  { number: '02', title: 'Entiende cada predio', text: 'Revisa superficies, régimen de propiedad y referencias catastrales. Mantén visibles la fuente y el alcance de cada dato.' },
  { number: '03', title: 'Profundiza con el IRM', text: 'Consulta el portal municipal, incorpora el documento y revisa los parámetros y condiciones urbanísticas del predio.' },
];

export default function ProductOverview({ onExplore, onConsult, onAnalytics }) {
  return <section className="product-overview" id="product-overview" aria-label="Presentación de PredioAI">
    <section className="po-hero" aria-labelledby="po-hero-title">
      <div className="po-hero-copy">
        <p className="po-eyebrow"><span aria-hidden="true" /> QUITO · DISTRITO METROPOLITANO <span className="po-pilot-label">PILOTO</span></p>
        <h1 id="po-hero-title">Tu próxima oportunidad empieza en <em>el territorio.</em></h1>
        <p className="po-hero-description">Catastro, cartografía e información urbanística en un mismo espacio. Una perspectiva más clara para los equipos que buscan, evalúan y desarrollan inmuebles.</p>
        <div className="po-hero-actions">
          <button type="button" className="po-button po-button-primary" onClick={onExplore}>Explorar predios <Arrow /></button>
          <button type="button" className="po-button po-button-secondary" onClick={onConsult}>Consultar un predio <Arrow diagonal /></button>
        </div>
        <p className="po-hero-footnote">Pensado para inmobiliarias, desarrolladores y equipos de arquitectura.</p>
      </div>
      <TerritoryIllustration />
    </section>

    <section className="po-workflow" aria-labelledby="po-workflow-title">
      <div className="po-section-heading"><p className="po-eyebrow">DEL MAPA A LA EVALUACIÓN</p><h2 id="po-workflow-title">Una consulta. <span>Más contexto para decidir.</span></h2></div>
      <ol className="po-steps">{steps.map(step => <li key={step.number}>
        <span className="po-step-number" aria-hidden="true">{step.number}</span>
        <h3>{step.title}</h3><p>{step.text}</p>
      </li>)}</ol>
    </section>

    <section className="po-product-path" aria-labelledby="po-product-path-title">
      <div className="po-current">
        <p className="po-eyebrow">EL PUNTO DE PARTIDA</p>
        <h2 id="po-product-path-title">Primero, la evidencia.<br /><span>Después, la inteligencia.</span></h2>
        <p>PredioAI reúne las piezas de la evaluación inicial en un flujo de trabajo que permite pasar de la búsqueda territorial a la revisión de un inmueble.</p>
        <ul className="po-evidence-list">
          <li><span>Exploración geográfica</span><small>Filtros, mapa y ficha catastral</small></li>
          <li><span>Contexto urbanístico</span><small>Consulta asistida del IRM y cruce PUGS preliminar</small></li>
          <li><span>Referencias con trazabilidad</span><small>Fuentes y limitaciones visibles</small></li>
        </ul>
        <p className="po-scope-note">Los registros catastrales no indican disponibilidad de venta. La evaluación requiere contrastar la documentación municipal vigente.</p>
      </div>
      <div className="po-next">
        <p className="po-next-label"><span aria-hidden="true">↗</span> PRÓXIMA ETAPA</p>
        <h3>De encontrar predios<br />a priorizar oportunidades.</h3>
        <p>El siguiente paso es un motor analítico para comparar predios con criterios explícitos y comprender patrones en el territorio.</p>
        <div className="po-next-features"><div><span>01 / SCORING</span><p>Priorización con variables, criterios y resultados explicables.</p></div><div><span>02 / SEGMENTACIÓN</span><p>Aprendizaje no supervisado para explorar grupos de predios con características similares.</p></div></div>
        <button type="button" className="po-roadmap-link" onClick={onAnalytics}>Conocer la hoja de ruta <Arrow /></button>
        <small className="po-next-note">En planificación. Estas capacidades aún no generan puntuaciones ni recomendaciones en la plataforma.</small>
      </div>
    </section>

    <section className="po-pilot" aria-labelledby="po-pilot-title">
      <div className="po-pilot-intro"><p className="po-eyebrow">UNA PROPUESTA PARA EQUIPOS INMOBILIARIOS</p><h2 id="po-pilot-title">Un piloto con preguntas reales.</h2><p>Una zona de interés. Un conjunto de predios. Un equipo que conoce el negocio. Ese es el punto de partida propuesto para evaluar PredioAI en un proceso de trabajo concreto.</p></div>
      <div className="po-pilot-plan"><h3>¿Qué evaluaríamos juntos?</h3><ul><li>La utilidad de los filtros para una búsqueda real.</li><li>La claridad de la información para revisar cada predio.</li><li>Las variables que deberían orientar el futuro scoring.</li></ul><button type="button" className="po-pilot-link" onClick={onExplore}>Comenzar por el territorio <Arrow /></button></div>
    </section>
  </section>;
}
