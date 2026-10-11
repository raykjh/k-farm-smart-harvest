import {expect,it} from 'vitest';
import {environmentWindows,type WeatherDay} from '../lib/environment-window';
import {regionalStandardSchema} from '../lib/regional-crop-standard';
import {cropCatalog} from '../lib/crop-catalog';
const rule={metric:'meanTemperatureC' as const,lowerC:15,upperC:25,consecutiveDays:3,minimumNightC:null};
const days=(values:(number|null)[]):WeatherDay[]=>values.map((v,i)=>({date:`2026-05-${String(i+1).padStart(2,'0')}`,meanTemperatureC:v,minTemperatureC:10,soilTemperatureC:null}));
it('dates move with temperature; does not backdate before consecutive requirement is met',()=>{
 expect(environmentWindows(rule,days([10,14,15,16,18,20]),'2026-05-01','2026-05-06').windows).toEqual([{from:'2026-05-05',to:'2026-05-06'}]);
 expect(environmentWindows(rule,days([15,16,18,20,20,20]),'2026-05-01','2026-05-06').windows[0].from).toBe('2026-05-03');
});
it('missing metric or missing calendar day breaks a streak',()=>{
 expect(environmentWindows(rule,days([15,15,null,15,15]),'2026-05-01','2026-05-05').windows).toEqual([]);
 expect(environmentWindows(rule,days([15,15,15,15]).filter((_,i)=>i!==1),'2026-05-01','2026-05-04').missingDays).toBe(1);
 expect(environmentWindows({...rule,metric:'soilTemperatureC'},days([20,20,20]),'2026-05-01','2026-05-03').status).toBe('INSUFFICIENT_DATA');
});
it('night constraint and heat stop eligibility, duplicates rejected',()=>{
 expect(environmentWindows({...rule,minimumNightC:12},days([20,20,20]),'2026-05-01','2026-05-03').status).toBe('NO_MATCH');
 expect(environmentWindows(rule,days([20,20,30,20,20]),'2026-05-01','2026-05-05').windows).toEqual([]);
 expect(()=>environmentWindows(rule,[...days([20]),...days([20])],'2026-05-01','2026-05-01')).toThrow('duplicate');
});
it('supports environment profile without fixed regional dates; preserves old calendar validation',()=>{
 const profile={catalogProfileId:cropCatalog[0].id,scope:'COMMON',region:'',practice:'test',variety:'',status:'DRAFT',reviewer:'',orchardStage:null,yieldLowKgPer1000m2:null,yieldHighKgPer1000m2:null,sourceUrls:[],notes:'',operations:[{code:'plant',name:'test',from:'',to:'',crossYear:false,timingMode:'ENVIRONMENT',environment:rule,minTemperatureC:null,maxTemperatureC:null,basis:'test fixture',mode:'MANUAL',capability:'',workers:1,operators:0,minutesPer1000m2:10,sourceUrl:'https://example.org/test'}]};
 expect(regionalStandardSchema.safeParse(profile).success).toBe(true);
 expect(regionalStandardSchema.safeParse({...profile,operations:[{...profile.operations[0],environment:null}]}).success).toBe(false);
 expect(regionalStandardSchema.safeParse({...profile,operations:[{...profile.operations[0],timingMode:'CALENDAR_OVERRIDE'}]}).success).toBe(false);
});
