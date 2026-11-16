import React, {useMemo, useState} from 'react';

// Conceptual rectangular parcel model. This is NOT a cadastral survey,
// subdivision design, residential density entitlement, or permit decision.
export default function ResidentialSimulator({area, minLot, minFront, cosPb, cosTotal, floors, setbacks, suffix, isPH}) {
  const [homes,setHomes]=useState(1);
  const [frontage,setFrontage]=useState(Math.max(1,Number(minFront)||30));
  const [mode,setMode]=useState('whole');
  const nArea=Number(area), nMinLot=Number(minLot), nCos=Number(cosPb), nTotal=Number(cosTotal);
  const front=Number(setbacks?.front)||0, rear=Number(setbacks?.rear)||0;
  const lateral=Number(setbacks?.lateral)||0, gap=Number(setbacks?.blocks)||0;
  const singleHomeDefault=Number.isFinite(nArea)&&nArea>0&&nArea<500;
  const effectiveHomes=singleHomeDefault?1:homes;
  const valid=Number.isFinite(nArea)&&nArea>0&&Number.isFinite(nCos)&&nCos>=0&&nCos<=100&&frontage>0;
  const scenario=useMemo(()=>{
    if(!valid)return null;
    const parcelArea=mode==='minimum'&&nMinLot>0?nMinLot:nArea;
    const depth=parcelArea/frontage;
    const envelopeW=Math.max(0,frontage-2*lateral), envelopeD=Math.max(0,depth-front-rear);
    const maxFootprint=Math.min(parcelArea*nCos/100,envelopeW*envelopeD);
    const maxFloorArea=Number.isFinite(nTotal)&&nTotal>0?parcelArea*nTotal/100:null;
    // Test a row and column grid with exact spacing in metres. Each candidate
    // rectangle is a square footprint, sized by COS and available envelope.
    const candidates=[];
    for(let columns=1;columns<=effectiveHomes;columns++){
      const rows=Math.ceil(effectiveHomes/columns);
      const width=(envelopeW-(columns-1)*gap)/columns;
      const height=(envelopeD-(rows-1)*gap)/rows;
      const side=Math.min(Math.sqrt(Math.max(0,maxFootprint)/effectiveHomes),width,height);
      if(side>0&&Number.isFinite(side))candidates.push({columns,rows,side});
    }
    const best=candidates.sort((a,b)=>b.side-a.side)[0]||null;
    const buildingFootprint=best?best.side**2:0;
    const totalFootprint=buildingFootprint*effectiveHomes;
    const perBuildingFloors=Number(floors)>0?Math.min(Number(floors)*buildingFootprint,(maxFloorArea||Infinity)/effectiveHomes):null;
    const dwellingRatio=suffix==='VU'?1:suffix==='VB'?2:null;
    const preliminaryUnits=nMinLot>0&&dwellingRatio?Math.floor(parcelArea/nMinLot)*dwellingRatio:null;
    return {parcelArea,depth,envelopeW,envelopeD,maxFootprint,maxFloorArea,best,
      buildingFootprint,totalFootprint,perBuildingFloors,preliminaryUnits,
      geometricFit:Boolean(best&&best.side>=3),gap};
  },[valid,mode,nArea,nMinLot,nCos,nTotal,frontage,front,rear,lateral,gap,effectiveHomes,floors,suffix]);
  const fmt=value=>Number(value).toLocaleString('es-EC',{maximumFractionDigits:2});
  return <section className="zoning-buildability" aria-label="Simulador conceptual de viviendas">
    <h3>Simulador conceptual de implantación residencial</h3>
    <p className="note">Modelo rectangular hipotético construido a partir de las medidas del IRM. Se comprueban COS, retiros y separación entre bloques mediante una distribución en cuadrícula; no se supone que la geometría real del predio sea rectangular.</p>
    {singleHomeDefault && <p className="note"><strong>Predio menor de 500 m²:</strong> se presenta únicamente un escenario conceptual de vivienda individual. Es una regla de visualización de PredioAI, no una prohibición normativa de otras tipologías o ampliaciones verticales.</p>}
    {!singleHomeDefault && nArea<1000 && <p className="note">Predio de 500–999 m²: los escenarios de varias viviendas son exploratorios; las dimensiones, retiros y permisos requieren revisión.</p>}
    <div className="capacity-inputs">
      <label>Escenario de terreno
        <select value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="whole">Lote completo ({valid?fmt(nArea):'—'} m²)</option>
          {!singleHomeDefault&&nMinLot>0&&<option value="minimum">Lote mínimo ({fmt(nMinLot)} m²)</option>}
        </select>
      </label>
      {!singleHomeDefault && <label>Viviendas hipotéticas: <strong>{homes}</strong>
        <input type="range" min="1" max="8" step="1" value={homes} onChange={e=>setHomes(Number(e.target.value))}/>
      </label>}
      <label>Frente hipotético (m)
        <input type="number" min={Math.max(1,Number(minFront)||1)} max="300" step="1" value={frontage} onChange={e=>setFrontage(Math.max(1,Number(e.target.value)||1))}/>
      </label>
    </div>
    {scenario ? <>
      <p className="note">Terreno supuesto: {fmt(frontage)} × {fmt(scenario.depth)} m. Envolvente tras retiros: {fmt(scenario.envelopeW)} × {fmt(scenario.envelopeD)} m. Separación entre bloques: {fmt(gap)} m.</p>
      <div className="capacity-inputs">
        <div><strong>Huella máxima por COS PB</strong><p>{fmt(scenario.parcelArea*nCos/100)} m²</p></div>
        <div><strong>Huella propuesta por vivienda</strong><p>{fmt(scenario.buildingFootprint)} m²</p></div>
        <div><strong>Dimensiones propuestas</strong><p>{scenario.best?fmt(scenario.best.side)+' × '+fmt(scenario.best.side)+' m':'No cabe en el modelo'}</p></div>
        <div><strong>Área máxima por vivienda con pisos</strong><p>{scenario.perBuildingFloors==null?'No disponible':fmt(scenario.perBuildingFloors)+' m²'}</p></div>
      </div>
      {(() => {
        // Uniform metres-to-pixels scale: a 30 x 83 m lot must not look square.
        // SVG viewBox remains fixed and responsive on desktop and mobile.
        const scale=Math.min(300/frontage,215/scenario.depth);
        const w=frontage*scale,h=scenario.depth*scale;
        const left=(360-w)/2,top=10+(215-h)/2;
        const rects=[];
        if(scenario.best&&scenario.envelopeW>0&&scenario.envelopeD>0){
          const {columns,side}=scenario.best;
          const usedW=columns*side+(columns-1)*gap;
          const usedD=scenario.best.rows*side+(scenario.best.rows-1)*gap;
          const x0=lateral+(scenario.envelopeW-usedW)/2;
          const y0=rear+(scenario.envelopeD-usedD)/2;
          for(let i=0;i<effectiveHomes;i++){
            const col=i%columns,row=Math.floor(i/columns);
            const x=left+(x0+col*(side+gap))*scale;
            const y=top+(y0+row*(side+gap))*scale;
            rects.push(<g key={i}><rect x={x} y={y} width={side*scale} height={side*scale} fill="#ce861b" stroke="#915e16"/><text x={x+side*scale/2} y={y+side*scale/2+3} fontSize="10" textAnchor="middle" fill="white">{i+1}</text></g>);
          }
        }
        return <svg viewBox="0 0 360 270" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Implantación conceptual proporcional de edificios dentro de un lote rectangular" style={{width:'100%',maxWidth:560,height:'auto',display:'block'}}>
          <rect x={left} y={top} width={w} height={h} fill="#e3eee5" stroke="#547a60" strokeWidth="2"/>
          {scenario.envelopeW>0&&scenario.envelopeD>0&&<rect x={left+lateral*scale} y={top+rear*scale} width={scenario.envelopeW*scale} height={scenario.envelopeD*scale} fill="none" stroke="#477c5b" strokeDasharray="5 4"/>}
          {rects}
          <rect x={left} y={top+h} width={w} height="18" fill="#6e7f85"/>
          <text x="180" y={Math.min(258,top+h+31)} textAnchor="middle" fontSize="10" fill="currentColor">Vía / frente supuesto: {fmt(frontage)} m</text>
        </svg>;
      })()}
      <p className="note">La planta está dibujada con la misma escala horizontal y vertical. Es un lote rectangular hipotético, no una medición catastral.</p>
      <p><strong>Cabida geométrica:</strong> {scenario.geometricFit?'Distribución rectangular ilustrativa encontrada.':'No se encontró una distribución útil con las restricciones seleccionadas.'}</p>
      <p><strong>Referencia de densidad:</strong> {scenario.preliminaryUnits!=null?`Hasta ${scenario.preliminaryUnits} vivienda(s) por la relación preliminar ${suffix} / lote mínimo; ${effectiveHomes>scenario.preliminaryUnits?'el escenario supera esta referencia.':'el escenario no supera esta referencia.'}`:'No determinada a partir del sufijo; requiere verificación normativa.'}</p>
      <p className="note">Una solución geométrica no autoriza viviendas adicionales. La cuadrícula no modela vías internas, topografía, retiros viales especiales, redes, zonas protegidas ni permisos. {isPH?'Propiedad horizontal: no atribuir capacidad del lote matriz a una unidad individual.':''}</p>
    </>:<p className="note">Cargue un IRM con área y COS PB válidos para activar el simulador.</p>}
  </section>;
}
