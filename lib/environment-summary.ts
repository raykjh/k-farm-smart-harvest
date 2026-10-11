import type {RegionalStandard} from './regional-crop-standard';
export function environmentSummary(o:RegionalStandard['operations'][number],ko:boolean){
 if(o.timingMode!=='ENVIRONMENT')return `${o.minTemperatureC??'—'} ~ ${o.maxTemperatureC??'—'} ℃`;
 const e=o.environment;if(!e)return ko?'환경 조건 미입력':'Conditions missing';
 const metric=({meanTemperatureC:ko?'일평균 기온':'Daily mean',minTemperatureC:ko?'일최저 기온':'Daily minimum',soilTemperatureC:ko?'지온':'Soil temperature'})[e.metric];
 return `${metric} ${e.lowerC??'—'} ~ ${e.upperC??'—'} ℃ · ${e.consecutiveDays}${ko?'일 연속':' consecutive days'}${e.minimumNightC===null?'':` · ${ko?'최저기온':'Minimum air'} ≥ ${e.minimumNightC} ℃`}`;
}
