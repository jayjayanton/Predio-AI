import React from 'react';
import '../styles/overview.css';
import '../styles/positioning.css';
import '../styles/homeowner-focus.css';
import '../styles/clarity.css';

function Arrow({ diagonal = false }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

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
  return <section className="product-overview po-simplified" aria-label="PredioAI: analizar planos y consultar propiedades">
    <section className="po-hero" aria-labelledby="po-hero-title">
      <div className="po-hero-copy">
        <p className="po-eyebrow"><span aria-hidden="true" /> PARA TU CASA Y TU PRÓXIMO PROYECTO <span className="po-pilot-label">PILOTO · QUITO</span></p>
        <h1 id="po-hero-title">Entiende tus planos.<br/><em>Prepara tu reforma.</em></h1>
        <p className="po-hero-description">¿Quieres pintar, cambiar pisos, reparar, remodelar o ampliar? PredioAI te ayuda a revisar planos de tu vivienda y consultar su información predial. Estamos desarrollando mediciones verificadas para preparar mejor cada intervención.</p>
        <div className="po-hero-actions">
          <button type="button" className="po-button po-button-primary" onClick={onBlueprints}>Iniciar mi proyecto <Arrow/></button>
          <button type="button" className="po-button po-button-secondary" onClick={onConsult}>Consultar mi predio <Arrow diagonal/></button>
        </div>
        <p className="po-hero-footnote">Para propietarios, arquitectos independientes y pequeños equipos de remodelación o construcción.</p>
        <p className="po-release-note"><strong>Prototipo actual:</strong> consulta catastral, IRM asistido e inspección interactiva de planos PDF/DXF. <strong>En desarrollo:</strong> medidas arquitectónicas verificadas y reportes exportables.</p>
      </div>
      <ProjectGuide/>
    </section>

    <section className="po-choose" aria-labelledby="po-choose-title">
      <p className="po-eyebrow">ESCOGE POR DÓNDE EMPEZAR</p>
      <h2 id="po-choose-title">Dos herramientas. Un mismo inmueble.</h2>
      <div className="po-choose-grid">
        <article className="po-choice po-choice-main">
          <div className="po-choice-top"><span className="po-choice-icon" aria-hidden="true">▧</span><span className="po-stage">Flujo experimental disponible</span></div>
          <h3>Quiero revisar los planos de mi casa</h3>
          <p>Para una reforma, reparación, pintura, cambio de pisos o ampliación. Consulta primero tu predio y luego incorpora los planos autorizados. Explora su geometría y lo que el documento contiene.</p>
          <p className="po-choice-note">La selección de líneas funciona; identificar muros y calcular superficies confiables sigue en desarrollo.</p>
          <button type="button" className="po-choice-action" onClick={onBlueprints}>Ir a Analizar planos <Arrow/></button>
        </article>
        <article className="po-choice">
          <div className="po-choice-top"><span className="po-choice-icon" aria-hidden="true">⌖</span><span className="po-stage">Consulta disponible</span></div>
          <h3>Quiero conocer la información de mi propiedad</h3>
          <p>Busca por número de predio o clave catastral para revisar áreas registradas, el mapa y la información urbanística disponible. Usa el IRM cuando sea pertinente al proyecto.</p>
          <p className="po-choice-note">Los datos municipales aportan contexto: no reemplazan los planos interiores ni un permiso de obra.</p>
          <button type="button" className="po-choice-action" onClick={onConsult}>Ir a Mi predio <Arrow/></button>
        </article>
      </div>
    </section>

    <section className="po-what" aria-labelledby="po-what-title">
      <div><p className="po-eyebrow">QUÉ ES · QUÉ NO ES</p><h2 id="po-what-title">Una herramienta de análisis previo, no una empresa de reformas.</h2></div>
      <div className="po-what-columns">
        <div><h3>Lo que ayuda a hacer</h3><p>Organizar información del inmueble, inspeccionar dibujos y preparar —cuando las medidas sean verificables— el alcance de una intervención.</p></div>
        <div><h3>Lo que no hace</h3><p>No contrata obreros, selecciona proveedores, administra una obra, calcula presupuestos finales ni realiza una reforma por ti.</p></div>
      </div>
    </section>

    <section className="po-use-cases" aria-labelledby="po-use-cases-title">
      <div className="po-section-heading"><p className="po-eyebrow">CASOS DE USO</p><h2 id="po-use-cases-title">¿Qué te gustaría mejorar?</h2></div>
      <div className="po-use-case-grid">
        <article><span className="po-case-number">01 / PINTURA</span><h3>Pintar paredes y techos</h3><p>Futura medición de superficies seleccionadas tras verificar alturas y aberturas.</p></article>
        <article><span className="po-case-number">02 / PISOS</span><h3>Cambiar el piso</h3><p>Futura medición de superficies de ambientes con escala comprobada.</p></article>
        <article><span className="po-case-number">03 / REPARACIÓN</span><h3>Reorganizar o reparar</h3><p>Revisar el plano existente y documentar las zonas que requieren intervención.</p></article>
        <article><span className="po-case-number">04 / AMPLIACIÓN</span><h3>Reconstruir o ampliar</h3><p>Consultar planos, predio e IRM antes de revisar la propuesta con un profesional.</p></article>
      </div>
      <p className="po-section-description">Estas son aplicaciones previstas del análisis de planos; PredioAI aún no entrega automáticamente medidas arquitectónicas certificadas.</p>
    </section>

    <section className="po-workflow" aria-labelledby="po-workflow-title">
      <div className="po-section-heading"><p className="po-eyebrow">CÓMO FUNCIONA EL PILOTO</p><h2 id="po-workflow-title">Tres pasos, sin confundir planos con obra.</h2></div>
      <ol className="po-steps po-home-steps">
        <li><span className="po-step-number">01</span><h3>Consulta tu predio</h3><p>Identifica la propiedad. No necesitas explorar el mapa de terrenos para iniciar este flujo.</p></li>
        <li><span className="po-step-number">02</span><h3>Aporta los planos que tengas</h3><p>PDF o DXF autorizado; IRM cuando corresponda. La solicitud municipal la haces tú o tu representante.</p></li>
        <li><span className="po-step-number">03</span><h3>Inspecciona la geometría</h3><p>Visualiza trazos, selecciona elementos y controla capas. La calibración y medición verificable es nuestro siguiente hito.</p></li>
      </ol>
      <p className="po-workflow-note"><strong>Estado del producto:</strong> inspección disponible, pero no es un sistema de diseño automático, gestión de obras, cotizaciones ni cálculo de materiales. Las cantidades confiables requieren comprobar escala, dimensiones y condiciones reales.</p>
    </section>

    <section className="po-plan-request" aria-labelledby="po-plan-request-title">
      <div><p className="po-eyebrow">DOCUMENTACIÓN</p><h2 id="po-plan-request-title">¿Todavía no tienes tus planos?</h2><p>Busca primero una copia entre los documentos de tu vivienda o con su arquitecto. Si necesitas solicitar documentación municipal, averigua qué dependencia custodia el expediente. Tú o tu representante autorizado realizan la solicitud; PredioAI no la presenta por ti.</p></div>
      <details className="po-request-details"><summary>Cómo preparar tus documentos</summary>
        <div><p><strong>Copias municipales.</strong> Quito dispone de un trámite de copias de documentos conservados por Gestión Documental y Archivos. No implica que todos los planos estén allí ni que se entreguen automáticamente por número de predio.</p>
          <a className="po-request-link" href="https://pam.quito.gob.ec/MDMQ_Tramites/Operativas/FrmFichaTramite?codtt=240" target="_blank" rel="noopener noreferrer">Consultar requisitos oficiales de copias documentales ↗</a>
          <p><strong>Qué reunir.</strong> Plantas, cortes, elevaciones, cuadro de áreas y revisiones. Consulta los formatos disponibles: no se garantiza un CAD original ni que el plano esté actualizado.</p>
          <p><strong>Para utilizar la herramienta.</strong> Usa únicamente archivos autorizados. Un PDF vectorial o DXF permite inspeccionar geometría; los escaneos pueden requerir otro procesamiento. No cargues aquí cédulas, contraseñas ni documentos ajenos al análisis.</p>
          <p className="po-request-note">Los planos no representan necesariamente el estado actual de la casa. Consulta siempre los requisitos vigentes con la entidad responsable.</p>
        </div>
      </details>
    </section>

    <section className="po-audiences" aria-labelledby="po-audiences-title">
      <div className="po-section-heading"><p className="po-eyebrow">PARA QUIÉN ES</p><h2 id="po-audiences-title">Para tu hogar y quienes te ayudan a mejorarlo.</h2></div>
      <div className="po-audience-grid po-core-audiences">
        <article><span className="po-stage">Hogar</span><h3>Propietarios y hogares</h3><p>Revisa planos y datos del inmueble para entender un proyecto de reparación o reforma.</p></article>
        <article><span className="po-stage">Arquitectura</span><h3>Arquitectos independientes y estudios pequeños</h3><p>Inspecciona documentos con tus clientes. Próximamente, medidas revisables con sus fuentes.</p></article>
        <article><span className="po-stage">Oficios y obra</span><h3>Empresas de remodelación y construcción</h3><p>Consulta los planos y prepara el alcance técnico. Los proveedores, materiales, precios y obra siguen bajo tu responsabilidad.</p></article>
      </div>
      <details className="po-secondary-audiences"><summary>Otras herramientas y posibilidades futuras</summary><div className="po-audience-grid">
        <article><span className="po-stage">Herramienta existente</span><h3>Exploración de predios</h3><p>También puedes buscar, filtrar y comparar predios. Esta herramienta es independiente del análisis de planos de una vivienda.</p><button type="button" className="po-pilot-link" onClick={onExplore}>Explorar predios <Arrow/></button></article>
        <article className="po-insurance-card"><span className="po-stage po-stage-planned">Posible extensión · no implementada</span><h3>Seguros y peritajes</h3><p>La revisión de daños con fotografías, planos y observaciones podría apoyar en el futuro a profesionales de evaluación.</p><p className="po-insurance-boundary">Un plano describe el diseño, no el daño ocurrido. No se determina seguridad estructural, cobertura ni indemnización automáticamente.</p></article>
      </div><div className="po-analytics-extension"><div><p className="po-eyebrow">ANALÍTICA FUTURA</p><h2>Scoring y segmentación predial</h2><p>Modelos multicriterio y agrupación no supervisada, todavía no implementados y separados del análisis de planos.</p></div><button type="button" className="po-button po-button-secondary" onClick={onAnalytics}>Ver futura analítica <Arrow/></button></div></details>
    </section>
  </section>;
}
