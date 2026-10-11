import type {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {registeredDemo} from '../../tests/registered-demo-fixture';
import {cropGuidelines} from '../../lib/crop-guidelines';
import {emptyConditions} from '../../lib/field-conditions';
import {intakeField} from '../../lib/registration-intake';
import {coordinationPolicyKey} from '../../lib/production-coordination-store';

/** Disposable DB inputs only, never a substitute scheduling or API implementation.
 * Public parcel identity is reused; ownership, people, resources and agronomy below
 * are hypothetical verification inputs, not claims about this actual parcel. */
export async function seedProductionCropReview(tx:Prisma.TransactionClient){
 const databases=await tx.$queryRaw<{current_database:string}[]>`SELECT current_database()`;
 if(!['kfarm_test','kfarm_centers_e2e'].includes(databases[0]?.current_database))throw Error('Disposable crop-review database required');
 await tx.workRecord.deleteMany({where:{workspace:{in:['sandbox','shared','reports']}}});
 await tx.outbox.deleteMany({where:{centerId:'demo'}});await tx.audit.deleteMany({where:{centerId:'demo'}});
 const state={...registeredDemo().state,ruleVersion:'CROP_AI_ISOLATED',fields:[],missions:[],staffCount:4,transportCount:2};
 await tx.center.upsert({where:{id:'demo'},create:{id:'demo',state:JSON.parse(JSON.stringify(state))},update:{state:JSON.parse(JSON.stringify(state))}});
 const operations=Object.fromEntries((['potato','pepper'] as const).map(crop=>[crop,Object.fromEntries(cropGuidelines[crop].steps.filter(s=>['PROCESS','REPEAT'].includes(s.kind)).map((s,i)=>[s.code,{from:`2032-${String(i+2).padStart(2,'0')}-01`,to:`2032-${String(i+2).padStart(2,'0')}-20`,laborMinutesPer1000m2:crop==='potato'?30:120}]))]));
 await tx.workRecord.create({data:{workspace:'sandbox',kind:'productionCriteria',id:'current',payload:{profiles:[{id:'isolated-crop-review',name:'격리 검증 입력 · 지역 농업처방 아님',context:{region:'계북면',operations}}]}}});
 await tx.workRecord.create({data:{...coordinationPolicyKey,payload:{yields:[],targets:[],specialties:[{centerId:'demo',crop:'pepper',status:'ESTABLISHED',bonus:3,sourceUrl:'https://example.invalid/isolated-crop-review',method:'가상 검증값: 실제 지역 특화 정책 아님',checkedOn:'2026-01-01',validUntil:'2032-12-31'}]}}});
 return state;
}
export function productionCropRegistration(version=0,pnu='5274036023106160004'){
 const {geometry,selected,...field}=intakeField(pnu,'전북특별자치도 장수군 계북면 농소리 616-4');
 return {requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:version,testDataOnly:true,continuousService:{from:'2026-01-01',until:null,continuousConsent:true},consultation:{farmer:{name:'홍가상',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},application:{policy:'OWNER_SERVICE_V1',residence:'계북면',cultivationHistory:'',supportReason:'',exceptionReason:'',review:'pending'},consent:true,step:3,fields:[{...field,area:'1000',mode:'delegated',conditions:{...emptyConditions(),region:'계북면',landUse:'upland',water:'yes',drainage:'good',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'unsuitable',potato:'suitable',pepper:'suitable'},evidence:'격리된 가상 입력: 실제 토양·경작권 확인 아님',checkedOn:'2026-01-01'}}]},cultivations:[]};
}
