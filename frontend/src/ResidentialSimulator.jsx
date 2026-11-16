import React, {useMemo, useState} from 'react';

// Conceptual rectangular parcel model. This is NOT a cadastral survey,
// subdivision design, residential density entitlement, or permit decision.
export default function ResidentialSimulator({area, minLot, minFront, cosPb, cosTotal, floors, setbacks, suffix, isPH}) {
  const [homes,setHomes]=useState(2);
  const [frontage,setFrontage]=useState(Math.max(1,Number(minFront)||30));
  const [mode,setMode]=useState('whole');
  const nArea=Number(area), nMinLot=Number(minLot), nCos=Number(cosPb), nTotal=Number(cosTotal);
  const front=Number(setbacks?.front)||0, rear=Number(setbacks?.rear)||0;
  const lateral=Number(setbacks?.lateral)||0, gap=Number(setbacks?.blocks)||0;
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
    for(let columns=1;columns<=homes;columns++){
      const rows=Math.ceil(homes/columns);
      const width=(envelopeW-(columns-1)*gap)/columns;
      const height=(envelopeD-(rows-1)*gap)/rows;
      const side=Math.min(Math.sqrt(Math.max(0,maxFootprint)/homes),width,height);
      if(side>0&&Number.isFinite(side))candidates.push({columns,rows,side});
    }
    const best=candidates.sort((a,b)=>b.side-a.side)[0]||null;
    const buildingFootprint=best?best.side**2:0;
    const totalFootprint=buildingFootprint*homes;
    const perBuildingFloors=Number(floors)>0?Math.min(Number(floors)*buildingFootprint,(maxFloorArea||Infinity)/homes):null;
    const dwellingRatio=suffix==='VU'?1:suffix==='VB'?2:null;
    const preliminaryUnits=nMinLot>0&&dwellingRatio?Math.floor(parcelArea/nMinLot)*dwellingRatio:null;
    return {parcelArea,depth,envelopeW,envelopeD,maxFootprint,maxFloorArea,best,
      buildingFootprint,totalFootprint,perBuildingFloors,preliminaryUnits,
      geometricFit:Boolean(best&&best.side>=3),gap};
  },[valid,mode,nArea,nMinLot,nCos,nTotal,frontage,front,rear,lateral,gap,homes,floors,suffix]);
  const fmt=value=>Number(value).toLocaleString('es-EC',{maximumFractionDigits:2});
  return <section className="zoning-buildability" aria-label="Simulador conceptual de viviendas">
    <h3>Simulador conceptual de implantación residencial</h3>
    <p className="note">Modelo rectangular hipotético construido a partir de las medidas del IRM. Se comprueban COS, retiros y separación entre bloques mediante una distribución en cuadrícula; no se supone que la geometría real del predio sea rectangular.</p>
    <div className="capacity-inputs">
      <label>Escenario de terreno
        <select value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="whole">Lote completo ({valid?fmt(nArea):'—'} m²)</option>
          {nMinLot>0&&<option value="minimum">Lote mínimo ({fmt(nMinLot)} m²)</option>}
        </select>
      </label>
      <label>Viviendas hipotéticas: <strong>{homes}</strong>
        <input type="range" min="1" max="8" step="1" value={homes} onChange={e=>setHomes(Number(e.target.value))}/>
      </label>
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
      <svg viewBox="0 0 360 270" role="img" aria-label="Implantación conceptual de edificios dentro de un lote rectangular" style={{width:'100%',maxWidth:560}}>
        <rect x="24" y="12" width="312" height="226" fill="#e3eee5" stroke="#547a60" strokeWidth="2"/>
        {scenario.best&&scenario.envelopeW>0&&scenario.envelopeD>0&&(()=>{
          const sx=312/frontage,sy=226/scenario.depth;
          const rects=[];
          const {columns,rows,side}=scenario.best;
          const usedW=columns*side+(columns-1)*gap;
          const usedD=rows*side+(rows-1)*gap;
          const x0=lateral+(scenario.envelopeW-usedW)/2;
          const y0=rear+(scenario.envelopeD-usedD)/2;
          for(let i=0;i<homes;i++){
            const col=i%columns,row=Math.floor(i/columns);
            rects.push(<g key={i}><rect x={24+(x0+col*(side+gap))*sx} y={12+(y0+row*(side+gap))*sy} width={side*sx} height={side*sy} fill="#ce861b" stroke="#915e16"/><text x={24+(x0+col*(side+gap)+side/2)*sx} y={12+(y0+row*(side+gap)+side/2)*sy} fontSize="11" textAnchor="middle" fill="white">{i+1}</text></g>);
          }
          return <><rect x={24+lateral*sx} y={12+rear*sy} width={scenario.envelopeW*sx} height={scenario.envelopeD*sy} fill="none" stroke="#477c5b" strokeDasharray="5 4"/>{rects}</>;
        })()}
        <rect x="24" y="238" width="312" height="20" fill="#6e7f85"/>
        <text x="180" y="252" textAnchor="middle" fontSize="11" fill="white">Vía / frente supuesto: {fmt(frontage)} m</text>
      </svg>
      <p><strong>Cabida geométrica:</strong> {scenario.geometricFit?'Distribución rectangular ilustrativa encontrada.':'No se encontró una distribución útil con las restricciones seleccionadas.'}</p>
      <p><strong>Referencia de densidad:</strong> {scenario.preliminaryUnits!=null?`Hasta ${scenario.preliminaryUnits} vivienda(s) por la relación preliminar ${suffix} / lote mínimo; ${homes>scenario.preliminaryUnits?'el escenario supera esta referencia.':'el escenario no supera esta referencia.'}`:'No determinada a partir del sufijo; requiere verificación normativa.'}</p>
      <p className="note">Una solución geométrica no autoriza viviendas adicionales. La cuadrícula no modela vías internas, topografía, retiros viales especiales, redes, zonas protegidas ni permisos. {isPH?'Propiedad horizontal: no atribuir capacidad del lote matriz a una unidad individual.':''}</p>
    </>:<p className="note">Cargue un IRM con área y COS PB válidos para activar el simulador.</p>}
  </section>;
}
