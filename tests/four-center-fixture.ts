import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {centerRegistry,emptyCenter} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {emptyConditions} from '../lib/field-conditions';

// Shared by in-process route tests and browser E2E. Never a production seed.
export const fourCenterTestUrl='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e';
export const fixtureToday=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export const fixtureYear=Number(fixtureToday.slice(0,4))+1;
export const fixtureDay=(md:string)=>`${fixtureYear}-${md}`;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));

export async function resetFourCenterFixture(){
 if(process.env.DATABASE_URL!==fourCenterTestUrl)throw Error('Dedicated four-center DB required');
 await db.$transaction(async tx=>{
  await tx.outbox.deleteMany();await tx.receipt.deleteMany();await tx.audit.deleteMany();await tx.workRecord.deleteMany();await tx.center.deleteMany();
  for(const c of centerRegistry){
   const s=emptyCenter(c.id);s.machines=([['TR','트랙터·경운 로터리',0.4],['RP','승용 이앙기',0.3],['CB','벼 콤바인',0.3],['DR','농업용 드론',1]] as const).flatMap(([code,type,capacityHaHour])=>[1,2].map(n=>({id:`${c.prefix}${code}0${n}`,name:type,type,capacityHaHour,status:'AVAILABLE' as const,safetyLock:false,ownerCenterId:c.id}))).filter(m=>c.id!=='janggye'||!m.id.includes('TR'));s.staffCount=4;s.transportCount=2;
   s.operatorRoster=[{id:randomUUID(),name:c.township+' 홍운영',active:true,kinds:['TR','RP','CB','DR'],weekdays:[0,1,2,3,4,5,6],from:fixtureDay('01-01'),until:fixtureDay('12-31'),excludedDates:[],startMinute:480,endMinute:960,evidence:'격리 검증용 개인 운영자 근무표'}];
   s.missions=[{id:'past-record',fieldId:'past-field',label:'과거 완료 기록',crop:'쌀',scheduledDate:'2026-01-02',month:1,owner:'센터 인력',status:'COMPLETED',resourceId:null,start:0,duration:1,deadline:32,priority:1,batchKey:'past-record',staff:1,transport:0}];
   await tx.center.create({data:{id:c.id,state:json(s)}});
   // Synthetic topology verifies shared-edge permissions, NOT real Korean borders.
   const [x,y,w,h]=({demo:[0,0,1,1],janggye:[1,0,1,2],cheoncheon:[0,1,1,1],gyenam:[5,0,1,1]} as Record<string,number[]>)[c.id];
   await tx.workRecord.create({data:{workspace:recordSpace(c.id),kind:'centerGeography',id:'current',payload:{source:'TEST_ONLY',geometry:{type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]}}}});
   const windows:Record<string,[string,string]>={seed:['04-08','04-12'],nursery:['04-13','05-14'],soil:['05-15','05-24'],plant:['05-25','05-31'],fertilize:['07-01','07-04'],heading:['07-01','07-04'],harvest:['10-01','10-12'],finish:['10-01','10-14']};
   const operations=Object.fromEntries(Object.entries(windows).map(([code,[from,to]])=>[code,{from:fixtureDay(from),to:fixtureDay(to),laborMinutesPer1000m2:30,rainSensitive:code==='fertilize',windLimitMs:code==='fertilize'?5:12,...(code==='fertilize'?{machineCode:'DR'}:{})}]));
   await tx.workRecord.create({data:{workspace:recordSpace(c.id),kind:'productionCriteria',id:'current',payload:{profiles:[{id:'test-season',name:'격리 검증용 작기',context:{region:c.township,operations:{rice:operations}}}]}}});
  }
 },{timeout:20000});
}

export function fourCenterRegistration(index:number,consultationId:string){
 const c=centerRegistry[index],pnu='527403602311099000'+index;
 const conditions={...emptyConditions(),region:c.township,landUse:'paddy',water:'yes',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'suitable',potato:'unsuitable',pepper:'unsuitable'},evidence:'격리 검증',checkedOn:fixtureToday};
 return {requestId:randomUUID(),consultationId,consultationVersion:0,fieldVersion:0,testDataOnly:true,cultivations:[],continuousService:{from:fixtureToday,until:null,continuousConsent:true},consultation:{farmer:{name:`홍검${['가','나','다','라'][index]}`,birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},application:{policy:'OWNER_SERVICE_V1',residence:'검증',cultivationHistory:'검증',supportReason:'검증',exceptionReason:'',review:'pending'},fields:[{id:randomUUID(),pnu,address:`전북특별자치도 장수군 ${c.township} 검증 농지`,area:'1000',crop:'',mode:'delegated',tenure:'owned',ownerName:'',ownerPhone:'',evidence:'none',end:'',callAt:'',operator:'',callResult:'pending',scope:'',verified:'pending',conditions}],consent:true,step:3}};
}
