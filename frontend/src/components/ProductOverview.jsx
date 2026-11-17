import React from 'react';
import '../styles/overview.css';
import '../styles/positioning.css';
import '../styles/homeowner-focus.css';

function Arrow({ diagonal = false }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const steps = [
  { number: '01', title: 'Ubica tu inmueble', text: 'Consulta el número de predio o la clave catastral. Conoce el terreno y distingue sus datos de los de la vivienda.', status: 'En el piloto' },
  { number: '02', title: 'Reúne planos e información', text: 'Adjunta planos PDF o CAD en formato DXF y el IRM cuando corresponda al flujo. Tú aportas los documentos que estás autorizado a utilizar.', status: 'En el piloto' },
  { number: '03', title: 'Explora el plano', text: 'Selecciona geometría, activa u oculta capas y cambia la vista. El visor no identifica automáticamente cada muro o habitación.', status: 'Visor experimental' },
  { number: '04', title: 'Valida medidas y documenta', text: 'La siguiente etapa permitirá confirmar escala y dimensiones, corregir selecciones y generar reportes de las superficies de intervención.', status: 'Próximo desarrollo', planned: true },
];

function ProjectGuide() {
  return <aside className="po-project-guide" aria-labelledby="po-guide-title">
    <div className="po-guide-top"><span>EL PUNTO DE PARTIDA</span><span className="po-stage">Piloto</span></div>
    <h2 id="po-guide-title">Tu vivienda.<br /><em>Un proyecto con contexto.</em></h2>
    <p className="po-guide-intro">Conectar lo que sabes del inmueble con lo que muestran sus planos.</p>
    <ol className="po-project-documents">
      <li><span className="po-file-label" aria-hidden="true">01</span><div><strong>El predio</strong><span>Ubicación y datos catastrales</span></div></li>
      <li><span className="po-file-label" aria-hidden="true">02</span><div><strong>Tus planos PDF / DXF</strong><span>Texto y geometría disponibles</span></div></li>
      <li><span className="po-file-label" aria-hidden="true">03</span><div><strong>El IRM, cuando corresponda</strong><span>Información urbanística para contrastar</span></div></li>
    </ol>
    <div className="po-guide-result"><strong>Un espacio para explorar y revisar</strong><p>Seleccionar geometría · mostrar capas · acercar el plano</p><small>Visor experimental. Unidades y escala aún sin verificar.</small></div>
  </aside>;
}

export default function ProductOverview({ onExplore, onConsult, onBlueprints, onAnalytics }) {
  return <section className="product-overview" id="product-overview" aria-label="PredioAI: vivienda, planos y proyectos">
    <section className="po-hero" aria-labelledby="po-hero-title">
      <div className="po-hero-copy">
        <p className="po-eyebrow"><span aria-hidden="true" /> VIVIENDA · PLANOS · PROYECTOS <span className="po-pilot-label">PILOTO EN QUITO</span></p>
        <h1 id="po-hero-title">Entiende tu casa.<br /><em>Planea su transformación.</em></h1>
        <p className="po-hero-description">Desde pintar una habitación o cambiar el piso hasta remodelar, reorganizar, reconstruir o ampliar tu vivienda. PredioAI conecta la información del predio, tus planos PDF/CAD y los datos del IRM en un espacio de análisis.</p>
        <div className="po-hero-actions">
          <button type="button" className="po-button po-button-primary" onClick={onBlueprints}>Iniciar mi proyecto <Arrow /></button>
          <button type="button" className="po-button po-button-secondary" onClick={onConsult}>Consultar mi predio <Arrow diagonal /></button>
        </div>
        <p className="po-hero-footnote">Para propietarios de vivienda, arquitectos independientes, estudios pequeños y empresas de remodelación y construcción.</p>
        <p className="po-release-note">Hoy: consulta predial e inspección interactiva de geometría. Próxima etapa: mediciones verificadas y reportes técnicos exportables.</p>
      </div>
      <ProjectGuide />
    </section>

    <section className="po-origin" aria-labelledby="po-origin-title">
      <p className="po-eyebrow">ASÍ NACIÓ LA IDEA</p>
      <div><h2 id="po-origin-title">Todo empieza con una vivienda.<br /><span>Y una mejora que quieres hacer realidad.</span></h2><p>¿Qué información necesito para pintar, cambiar pisos, reparar un muro o ampliar un espacio? La idea es convertir planos y documentos en información que puedas explorar y, con medidas verificadas, usar para preparar una intervención. El catastro aporta contexto; el proyecto de la vivienda es el centro.</p></div>
    </section>

    <section className="po-use-cases" aria-labelledby="po-use-cases-title">
      <div className="po-section-heading"><p className="po-eyebrow">DE LO COTIDIANO A UN PROYECTO MAYOR</p><h2 id="po-use-cases-title">¿Qué quieres cambiar en casa?</h2></div>
      <p className="po-section-description">Estos son los trabajos que guían el desarrollo del módulo de mediciones. La inspección de planos ya existe; las cantidades verificadas todavía no se generan.</p>
      <div className="po-use-case-grid">
        <article><span className="po-case-number">01 / PINTURA</span><h3>Pintar paredes y techos</h3><p>Seleccionar las superficies de interés y revisar alturas, caras de muro y aberturas antes de obtener el área a pintar.</p></article>
        <article><span className="po-case-number">02 / PISOS</span><h3>Cambiar el piso</h3><p>Delimitar los ambientes y verificar su superficie. Los materiales y el presupuesto los defines tú con el proveedor.</p></article>
        <article><span className="po-case-number">03 / REMODELACIÓN</span><h3>Reorganizar o reparar</h3><p>Ubicar habitaciones y elementos a intervenir, documentar lo que se conoce y señalar lo que requiere revisión.</p></article>
        <article><span className="po-case-number">04 / CONSTRUCCIÓN</span><h3>Reconstruir o ampliar</h3><p>Reunir planos y contexto del IRM para preparar la revisión del proyecto con profesionales, sin confundirla con una aprobación.</p></article>
      </div>
    </section>

    <section className="po-workflow" aria-labelledby="po-workflow-title">
      <div className="po-section-heading"><p className="po-eyebrow">DEL PREDIO AL PLANO Y A LA INTERVENCIÓN</p><h2 id="po-workflow-title">Tu proyecto. <span>La información para prepararlo.</span></h2></div>
      <ol className="po-steps po-home-steps">{steps.map(step => <li key={step.number}>
        <span className="po-step-number" aria-hidden="true">{step.number}</span><h3>{step.title}</h3><p>{step.text}</p><span className={`po-stage${step.planned ? ' po-stage-planned' : ''}`}>{step.status}</span>
      </li>)}</ol>
      <p className="po-workflow-note">En este piloto, consulta primero el predio para continuar a Proyecto y planos. PDF vectorial y DXF permiten inspeccionar geometría disponible; un escaneo puede requerir procesamiento adicional. DWG requiere conversión previa a DXF.</p>
    </section>

    <section className="po-plan-request" aria-labelledby="po-plan-request-title">
      <div><p className="po-eyebrow">ANTES DE EMPEZAR</p><h2 id="po-plan-request-title">¿Todavía no tienes tus planos?</h2><p>Revisa los documentos de tu vivienda o consulta al profesional que los elaboró. Si necesitas una copia municipal, identifica primero qué dependencia conserva el expediente. Tú o tu representante autorizado realizan la solicitud; PredioAI no la presenta por ti.</p></div>
      <details className="po-request-details"><summary>Cómo preparar tus documentos</summary>
        <div><p><strong>Solicitud municipal.</strong> Quito publica un trámite para copias de documentos bajo custodia de Gestión Documental y Archivos. Consulta allí si tu expediente está disponible o qué dependencia debes contactar. No es una descarga automática de planos por número de predio.</p>
        <a className="po-request-link" href="https://pam.quito.gob.ec/MDMQ_Tramites/Operativas/FrmFichaTramite?codtt=240" target="_blank" rel="noopener noreferrer">Consultar requisitos oficiales de copias documentales ↗</a>
        <p><strong>Qué conviene reunir.</strong> Plantas, cortes, elevaciones, cuadro de áreas y revisiones disponibles. Confirma con el custodio qué archivos puede entregar: no se garantiza un CAD original ni un plano completo o actualizado de cada vivienda.</p>
        <p><strong>Cuando tengas el archivo.</strong> Aporta una copia que estés autorizado a procesar. Un PDF vectorial o DXF permite inspeccionar geometría; un PDF escaneado necesita otro tratamiento y no garantiza mediciones. No cargues aquí cédulas, contraseñas ni documentos ajenos al análisis del proyecto.</p>
        <p className="po-request-note">Los planos describen lo documentado, no necesariamente el estado actual de la casa. Los requisitos y la disponibilidad se confirman con la entidad responsable. El enlace es una guía, no un trámite gestionado por PredioAI.</p></div>
      </details>
    </section>

    <section className="po-product-path" aria-labelledby="po-product-path-title">
      <div className="po-current">
        <p className="po-eyebrow">LO QUE YA PUEDES EXPLORAR</p>
        <h2 id="po-product-path-title">Documentos conectados.<br /><span>Información que puedes revisar.</span></h2>
        <ul className="po-evidence-list">
          <li><span>Tu inmueble en contexto</span><small>Ficha catastral, mapa y revisión asistida del IRM</small></li>
          <li><span>Planos y actividades de intervención</span><small>Inspección PDF/DXF y selección del tipo de trabajo</small></li>
          <li><span>Geometría interactiva</span><small>Selección múltiple, capas y zoom, sin medidas verificadas</small></li>
          <li><span>Resumen documental preliminar</span><small>Evidencia extraída y datos pendientes; no un informe técnico certificado</small></li>
        </ul>
        <button type="button" className="po-pilot-link" onClick={onBlueprints}>Abrir Planos y remodelación <Arrow /></button>
      </div>
      <div className="po-next">
        <p className="po-next-label"><span aria-hidden="true">↗</span> PRÓXIMO DESARROLLO DEL MÓDULO DE PLANOS</p>
        <h3>De seleccionar geometría<br />a obtener medidas revisables.</h3>
        <p>Confirmar unidades y escala, asociar elementos del plano con la intervención y calcular solo cuando exista información suficiente.</p>
        <div className="po-next-features"><div><span>01 / MEDICIONES</span><p>Longitudes y superficies con su fuente, correcciones y datos faltantes visibles.</p></div><div><span>02 / REPORTES</span><p>Resultados revisados que puedas compartir con tu arquitecto, contratista o cliente.</p></div></div>
        <small className="po-next-note">Objetivo: reducir mediciones repetitivas y algunas visitas preliminares cuando los planos sean adecuados. El ahorro debe validarse; no se calculan costos ni se sustituyen inspecciones necesarias.</small>
      </div>
    </section>

    <section className="po-audiences" aria-labelledby="po-audiences-title">
      <div className="po-section-heading"><p className="po-eyebrow">NUESTRO FOCO</p><h2 id="po-audiences-title">Para tu hogar. <span>Y quienes trabajan contigo.</span></h2></div>
      <div className="po-audience-grid po-core-audiences">
        <article><span className="po-stage">Tu vivienda</span><h3>Propietarios y hogares</h3><p>Entender el trabajo que quieres hacer, reunir los planos y conocer qué información falta antes de pintar, cambiar pisos, remodelar o ampliar.</p></article>
        <article><span className="po-stage">Tu práctica profesional</span><h3>Arquitectos independientes y estudios pequeños</h3><p>Explorar documentos con tus clientes y preparar una revisión ordenada. La próxima etapa busca facilitar mediciones verificadas y reportes, sin sustituir tu criterio profesional.</p></article>
        <article><span className="po-stage">Tus proyectos de obra</span><h3>Empresas de remodelación y construcción</h3><p>Conectar el encargo del propietario con la información de los planos. El objetivo es reducir trabajo repetitivo al preparar superficies y alcances; los materiales y precios siguen a cargo de tu equipo.</p></article>
      </div>
      <details className="po-secondary-audiences"><summary>Aplicaciones complementarias y futuras</summary><div className="po-audience-grid">
        <article><span className="po-stage">Herramientas complementarias del piloto</span><h3>Inmobiliarias y desarrolladores</h3><p>La búsqueda y comparación de predios siguen disponibles para revisar alternativas y su contexto municipal. No son el centro del piloto de remodelación.</p><button type="button" className="po-pilot-link" onClick={onExplore}>Explorar predios <Arrow /></button></article>
        <article className="po-insurance-card"><span className="po-stage po-stage-planned">Posible extensión · no implementada</span><h3>Seguros y peritajes</h3><p>Una posible etapa posterior conectaría planos y evidencia de afectaciones para apoyar informes revisados por profesionales. No es una capacidad del piloto actual.</p><p className="po-insurance-boundary">Un plano describe el diseño, no el daño ocurrido. Esta extensión necesitaría evidencia del estado real y validación profesional; no determinaría por sí sola seguridad estructural, cobertura o indemnización.</p></article>
      </div></details>
    </section>

    <section className="po-pilot" aria-labelledby="po-pilot-title">
      <div className="po-pilot-intro"><p className="po-eyebrow">VALIDAR CON PROYECTOS REALES</p><h2 id="po-pilot-title">Una vivienda. Un trabajo concreto.<br />Un resultado que podamos comprobar.</h2><p>El piloto propuesto parte de planos autorizados y una intervención definida con su propietario, un arquitecto o una pequeña empresa de remodelación. Compararíamos el trabajo manual con el flujo digital para comprobar utilidad, precisión y tiempo.</p></div>
      <div className="po-pilot-plan"><h3>Qué queremos demostrar</h3><ul><li>Que una persona entiende el proyecto y los datos que faltan.</li><li>Que las futuras mediciones coinciden con referencias verificadas.</li><li>Que el flujo reduce trabajo repetitivo y permite identificar qué visitas siguen siendo necesarias.</li></ul><button type="button" className="po-pilot-link" onClick={onBlueprints}>Comenzar por mi proyecto <Arrow /></button></div>
    </section>

    <section className="po-analytics-extension" aria-labelledby="po-analytics-title"><div><p className="po-eyebrow">LÍNEA COMPLEMENTARIA · EN PLANIFICACIÓN</p><h2 id="po-analytics-title">El territorio también tiene su hoja de ruta.</h2><p>El scoring explicable y el aprendizaje no supervisado siguen previstos para priorizar y agrupar predios. Son una línea complementaria, no un requisito para analizar planos ni un detector de daños.</p></div><button type="button" className="po-button po-button-secondary" onClick={onAnalytics}>Ver futura analítica <Arrow /></button></section>
  </section>;
}
