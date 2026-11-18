import React, {useState} from 'react';
import '../styles/overview.css';
import '../styles/positioning.css';
import '../styles/homeowner-focus.css';
import '../styles/clarity.css';

function Arrow({ diagonal = false }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ProjectGuide() {
  const [proposal, setProposal] = useState('table');
  return <aside className="po-project-guide" aria-labelledby="po-guide-title">
    <div className="po-guide-top"><span>DEL PLANO A LA IDEA</span><span className="po-stage">Ejemplo conceptual</span></div>
    <h2 id="po-guide-title">Dale espacio<br /><em>a lo que imaginas.</em></h2>
    <div className="po-plan-preview">
      <svg viewBox="0 0 360 265" role="img" aria-label={`Planta ficticia con ${proposal === 'table' ? 'mesa de 1,60 por 0,90 metros' : proposal === 'circle' ? 'círculo de 1,20 metros de diámetro' : 'ampliación propuesta de 2 por 2,80 metros'}`}>
        <defs><pattern id="studio-preview-grid" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0H0V15" fill="none" stroke="#d5ded5" strokeWidth=".55" /></pattern></defs>
        <rect width="360" height="265" rx="10" fill="#f5f6f0" /><rect x="15" y="15" width="330" height="230" fill="url(#studio-preview-grid)" />
        <path d="M44 48H272V200H44Z" fill="#fffdf6" stroke="#315b50" strokeWidth="4" />
        <path d="M188 48V112M188 142V200M44 92H188" fill="none" stroke="#315b50" strokeWidth="3" />
        <path d="M188 112H158M158 112A30 30 0 0 0 188 142" fill="none" stroke="#8fa798" strokeWidth="1.2" />
        <path d="M66 48H118M44 125V165M216 200H250" fill="none" stroke="#adc5bb" strokeWidth="5" />
        <rect x="59" y="64" width="50" height="15" rx="3" fill="#e5ebe2" stroke="#a7b9aa" />
        <rect x="204" y="64" width="47" height="65" rx="3" fill="#e5ebe2" stroke="#a7b9aa" />
        <path d="M209 80H246M229 68V79" fill="none" stroke="#a7b9aa" />
        <text x="67" y="180" fontSize="9" fill="#648075" letterSpacing="1.8">SALA</text><text x="205" y="178" fontSize="8" fill="#648075" letterSpacing="1">ESTUDIO</text>
        {proposal === 'table' && <g><rect x="94" y="116" width="48" height="27" rx="3" fill="#cee6d8" stroke="#246c52" strokeWidth="2" /><path d="M94 107V101M142 107V101M94 104H142" stroke="#246c52" strokeWidth=".8"/><text x="118" y="98" textAnchor="middle" fontSize="10" fill="#246c52">1,60 m</text><text x="150" y="133" fontSize="9" fill="#246c52">0,90 m</text></g>}
        {proposal === 'circle' && <g><circle cx="118" cy="130" r="18" fill="#cee6d8" stroke="#246c52" strokeWidth="2"/><path d="M100 130H136" stroke="#246c52" strokeWidth=".8"/><text x="118" y="104" textAnchor="middle" fontSize="10" fill="#246c52">Ø 1,20 m</text></g>}
        {proposal === 'extension' && <g><path d="M272 116H332V200H272Z" fill="#f6debd" fillOpacity=".85" stroke="#b96d34" strokeWidth="2" strokeDasharray="5 3"/><path d="M272 108V101M332 108V101M272 104H332" stroke="#b96d34" strokeWidth=".8"/><text x="302" y="98" textAnchor="middle" fontSize="10" fill="#9e592a">2,00 m</text><text x="302" y="154" textAnchor="middle" fontSize="11" fill="#9e592a">5,60 m²</text><text x="302" y="170" textAnchor="middle" fontSize="8" fill="#9e592a">PROPUESTA</text></g>}
        <path d="M44 220H104M44 216V224M74 217V223M104 216V224" stroke="#6d8277" fill="none"/><text x="44" y="236" fontSize="8" fill="#6d8277">0</text><text x="101" y="236" fontSize="8" fill="#6d8277">2 m</text>
        <text x="333" y="35" textAnchor="end" fontSize="8" fill="#809489">PLANTA · EJEMPLO FICTICIO</text>
      </svg>
    </div>
    <div className="po-preview-options" role="group" aria-label="Probar una idea en el ejemplo">
      {[['table','Mesa'],['circle','Círculo'],['extension','Ampliación']].map(([value,label]) => <button type="button" key={value} aria-pressed={proposal === value} onClick={() => setProposal(value)}>{label}</button>)}
    </div>
    <div className="po-guide-result" aria-live="polite"><strong>{proposal === 'extension' ? 'Explora una nueva superficie.' : 'Comprueba cómo encaja.'}</strong><p>{proposal === 'extension' ? 'La huella, el predio y el IRM aportan contexto a la propuesta.' : 'Introduce medidas reales. Mueve la figura sobre tu plano.'}</p><small>Esquema ficticio. Tu proyecto empieza con su propio archivo.</small></div>
  </aside>;
}

export default function ProductOverview({ onExplore, onConsult, onBlueprints, onAnalytics }) {
  return <section className="product-overview po-simplified" aria-label="PredioAI: analizar planos y consultar propiedades">
    <section className="po-hero" aria-labelledby="po-hero-title">
      <div className="po-hero-copy">
        <p className="po-eyebrow"><span aria-hidden="true" /> PARA TU CASA Y TU PRÓXIMO PROYECTO <span className="po-pilot-label">PILOTO · QUITO</span></p>
        <h1 id="po-hero-title">Entiende tus planos.<br/><em>Prepara tu reforma.</em></h1>
        <p className="po-hero-description">¿Quieres pintar, cambiar pisos, reparar, remodelar o ampliar? Explora los planos de tu vivienda, prueba ideas con medidas reales y reúne la información que necesitas para conversar con tu arquitecto.</p>
        <div className="po-hero-actions">
          <button type="button" className="po-button po-button-primary" onClick={onBlueprints}>Iniciar mi proyecto <Arrow/></button>
          <button type="button" className="po-button po-button-secondary" onClick={onConsult}>Consultar mi predio <Arrow diagonal/></button>
        </div>
        <p className="po-hero-footnote">Para propietarios, arquitectos independientes y pequeños equipos de remodelación o construcción.</p>
        <p className="po-release-note"><strong>Disponible en el piloto:</strong> planos PDF / CAD / ZIP, mediciones con escala confirmada, figuras con dimensiones reales y estudios de implantación con datos del predio e IRM revisados. La verificación arquitectónica y municipal requiere revisión profesional.</p>
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
          <p>Para una reforma, reparación, pintura, cambio de pisos o ampliación. Empieza con un plano autorizado y explora lo que contiene. Puedes agregar después la información del predio.</p>
          <p className="po-choice-note">Mide un contorno, coloca una mesa o dibuja una ampliación. Después, extrae la huella para estudiar su implantación.</p>
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
        <article><span className="po-case-number">02 / PISOS</span><h3>Cambiar el piso</h3><p>Mide un contorno cerrado con una escala confirmada y revisa qué superficie representa.</p></article>
        <article><span className="po-case-number">03 / DISTRIBUCIÓN</span><h3>Hacer espacio para tus ideas</h3><p>Coloca círculos y rectángulos con dimensiones reales para explorar muebles y nuevas distribuciones.</p></article>
        <article><span className="po-case-number">04 / AMPLIACIÓN</span><h3>Estudiar una ampliación</h3><p>Extrae una huella, ubícala en el predio y contrasta la propuesta con los parámetros del IRM revisados.</p></article>
      </div>
      <p className="po-section-description">Estas son aplicaciones previstas del análisis de planos; PredioAI aún no entrega automáticamente medidas arquitectónicas certificadas.</p>
    </section>

    <section className="po-workflow" aria-labelledby="po-workflow-title">
      <div className="po-section-heading"><p className="po-eyebrow">CÓMO FUNCIONA EL PILOTO</p><h2 id="po-workflow-title">Del plano a una revisión con contexto.</h2></div>
      <ol className="po-steps po-home-steps">
        <li><span className="po-step-number">01</span><h3>Elige la actividad y aporta tu plano</h3><p>PDF, DXF o DWG autorizado; usa un ZIP si tienes varios dibujos. Para pintura o cambio de acabado de piso puedes empezar sin consulta predial ni IRM.</p></li>
        <li><span className="po-step-number">02</span><h3>Mide y prueba tu propuesta</h3><p>Confirma la escala, explora los elementos y añade figuras con medidas reales. Selecciona la huella de planta baja para continuar con la implantación.</p></li>
        <li><span className="po-step-number">03</span><h3>Completa el contexto de tu vivienda</h3><p>Vincula el predio y aporta el IRM cuando corresponda a la revisión. La solicitud de documentos municipales la haces tú o tu representante.</p></li>
      </ol>
      <p className="po-workflow-note"><strong>Estado del producto:</strong> inspección disponible, pero no es un sistema de diseño automático, gestión de obras, cotizaciones ni cálculo de materiales. Las cantidades confiables requieren comprobar escala, dimensiones y condiciones reales.</p>
    </section>

    <section className="po-plan-request" aria-labelledby="po-plan-request-title">
      <div><p className="po-eyebrow">DOCUMENTACIÓN</p><h2 id="po-plan-request-title">¿Todavía no tienes tus planos?</h2><p>Busca primero una copia entre los documentos de tu vivienda o con su arquitecto. Si necesitas solicitar documentación municipal, averigua qué dependencia custodia el expediente. Tú o tu representante autorizado realizan la solicitud; PredioAI no la presenta por ti.</p></div>
      <details className="po-request-details"><summary>Cómo preparar tus documentos</summary>
        <div><p><strong>Copias municipales.</strong> Quito dispone de un trámite de copias de documentos conservados por Gestión Documental y Archivos. No implica que todos los planos estén allí ni que se entreguen automáticamente por número de predio.</p>
          <a className="po-request-link" href="https://pam.quito.gob.ec/MDMQ_Tramites/Operativas/FrmFichaTramite?codtt=240" target="_blank" rel="noopener noreferrer">Consultar requisitos oficiales de copias documentales ↗</a>
          <p><strong>Qué reunir.</strong> Plantas, cortes, elevaciones, cuadro de áreas y revisiones. Consulta los formatos disponibles: no se garantiza un CAD original ni que el plano esté actualizado.</p>
          <p><strong>Para utilizar la herramienta.</strong> Usa únicamente archivos autorizados en PDF, DXF o DWG. El DWG se convierte en el servidor para inspeccionar la geometría compatible; la vista puede ser parcial. Los PDF escaneados pueden requerir otro procesamiento. No cargues aquí cédulas, contraseñas ni documentos ajenos al análisis.</p>
          <p className="po-request-note">Los planos no representan necesariamente el estado actual de la casa. Consulta siempre los requisitos vigentes con la entidad responsable.</p>
        </div>
      </details>
    </section>

    <section className="po-audiences" aria-labelledby="po-audiences-title">
      <div className="po-section-heading"><p className="po-eyebrow">PARA QUIÉN ES</p><h2 id="po-audiences-title">Para tu hogar y quienes te ayudan a mejorarlo.</h2></div>
      <div className="po-audience-grid po-core-audiences">
        <article><span className="po-stage">Hogar</span><h3>Propietarios y hogares</h3><p>Revisa planos y datos del inmueble para entender un proyecto de reparación o reforma.</p></article>
        <article><span className="po-stage">Arquitectura</span><h3>Arquitectos independientes y estudios pequeños</h3><p>Inspecciona documentos y calcula medidas de la geometría seleccionada con una escala confirmada. Revisa sus fuentes con tus clientes.</p></article>
        <article><span className="po-stage">Oficios y obra</span><h3>Empresas de remodelación y construcción</h3><p>Consulta los planos y prepara el alcance técnico. Los proveedores, materiales, precios y obra siguen bajo tu responsabilidad.</p></article>
      </div>
      <details className="po-secondary-audiences"><summary>Otras herramientas y posibilidades futuras</summary><div className="po-audience-grid">
        <article><span className="po-stage">Herramienta existente</span><h3>Exploración de predios</h3><p>También puedes buscar, filtrar y comparar predios. Esta herramienta es independiente del análisis de planos de una vivienda.</p><button type="button" className="po-pilot-link" onClick={onExplore}>Explorar predios <Arrow/></button></article>
        <article className="po-insurance-card"><span className="po-stage po-stage-planned">Posible extensión · no implementada</span><h3>Seguros y peritajes</h3><p>La revisión de daños con fotografías, planos y observaciones podría apoyar en el futuro a profesionales de evaluación.</p><p className="po-insurance-boundary">Un plano describe el diseño, no el daño ocurrido. No se determina seguridad estructural, cobertura ni indemnización automáticamente.</p></article>
      </div><div className="po-analytics-extension"><div><p className="po-eyebrow">ANALÍTICA FUTURA</p><h2>Scoring y segmentación predial</h2><p>Modelos multicriterio y agrupación no supervisada, todavía no implementados y separados del análisis de planos.</p></div><button type="button" className="po-button po-button-secondary" onClick={onAnalytics}>Ver futura analítica <Arrow/></button></div></details>
    </section>
  </section>;
}
