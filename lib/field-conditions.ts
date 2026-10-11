import {z} from 'zod';
import {cropCodes,legacyCropCodes,isOrchardCrop,type SupportedCropCode} from './crop-registry';
const known=z.enum(['unknown','yes','no']);
const suitability=z.enum(['unknown','suitable','marginal','unsuitable']);
export const fieldConditions=z.object({
 landUse:z.enum(['unknown','paddy','upland','orchard']),water:known,drainage:z.enum(['unknown','good','poor']),
 machineAccess:known,laborAvailable:known,region:z.string().trim().max(100),
 climate:z.object({rice:suitability,potato:suitability,pepper:suitability}).catchall(suitability).refine(v=>Object.keys(v).every(k=>(cropCodes as readonly string[]).includes(k)),'지원하지 않는 작물 적합성'),
 existingBearingOrchard:z.boolean().optional(),existingOrchardCrop:z.enum(['apple','pear','peach','grape','plum']).optional(),farmerCrew:z.number().int().min(1).max(100).optional(),
 evidence:z.string().trim().max(1000),checkedOn:z.string().refine(v=>v===''||/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),
}).strict();
export type FieldConditions=z.infer<typeof fieldConditions>;
export const emptyConditions=():FieldConditions=>({landUse:'unknown',water:'unknown',drainage:'unknown',machineAccess:'unknown',laborAvailable:'unknown',region:'',climate:{rice:'unknown',potato:'unknown',pepper:'unknown'},evidence:'',checkedOn:''});
export const recommendationPolicy={version:'field-conditions-v1',climate:40,soilWater:25,execution:25,labor:10};
// Operator policy points, not government agronomic coefficients or a yield forecast.
// Climate suitability must be reviewed for each crop/variety with local evidence.
export function recommendConditions(raw?:FieldConditions){
 const c=raw?fieldConditions.parse(raw):emptyConditions();
 const considered=[...new Set<SupportedCropCode>([...legacyCropCodes,...Object.keys(c.climate) as SupportedCropCode[]])];
 return considered.map(crop=>{
  const missing:string[]=[],blocked:string[]=[];
  if(!c.evidence||!c.checkedOn||!c.region)missing.push('EVIDENCE_REQUIRED');
  if(c.checkedOn&&c.checkedOn>new Date(Date.now()+9*3600000).toISOString().slice(0,10))missing.push('FUTURE_REVIEW');
  if(c.landUse==='unknown')missing.push('LAND_USE');
  if(!c.climate[crop]||c.climate[crop]==='unknown')missing.push('REGIONAL_CLIMATE');
  if(c.climate[crop]==='unsuitable')blocked.push('CLIMATE_UNSUITABLE');
  if(crop==='rice'){
   if(c.water==='unknown')missing.push('WATER');
   if(c.water==='no'||c.landUse==='upland'||c.landUse==='orchard')blocked.push('PADDY_WATER_REQUIRED');
  }else{
   if(c.drainage==='unknown')missing.push('DRAINAGE');
   if(c.drainage==='poor'||c.landUse==='paddy')blocked.push('UPLAND_DRAINAGE_REVIEW');
   if(isOrchardCrop(crop)&&(!c.existingBearingOrchard||c.landUse!=='orchard'))blocked.push('EXISTING_BEARING_ORCHARD_REQUIRED');
   if(isOrchardCrop(crop)&&!c.existingOrchardCrop)missing.push('EXISTING_ORCHARD_CROP');
   if(isOrchardCrop(crop)&&c.existingOrchardCrop&&c.existingOrchardCrop!==crop)blocked.push('EXISTING_ORCHARD_PRESERVED');
   if(!isOrchardCrop(crop)&&c.landUse==='orchard')blocked.push('EXISTING_ORCHARD_PRESERVED');
  }
  if(c.machineAccess==='unknown')missing.push('ACCESS');
  if(c.laborAvailable==='unknown')missing.push('LABOR');
  if(c.machineAccess==='no'&&c.laborAvailable==='no'||crop==='pepper'&&c.laborAvailable==='no')blocked.push('LABOR_REQUIRED');
  const score=blocked.length?0:missing.length?null:(c.climate[crop]==='suitable'?40:20)+25+(c.machineAccess==='yes'?25:crop==='pepper'?15:5)+(c.laborAvailable==='yes'?10:0);
  return {crop,score,missing,blocked,status:blocked.length?'BLOCKED':missing.length?'PENDING':'PROVISIONAL',policyVersion:recommendationPolicy.version};
 }).sort((a,b)=>(b.score??-1)-(a.score??-1));
}
