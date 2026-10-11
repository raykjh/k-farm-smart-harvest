import {z} from 'zod';
import {requireProviderArtifact,ProviderArtifactError} from './provider-artifacts';
import {demoOperationWindow} from './demo-operation-window';
import {consultationSchema} from './consultation';
import {fieldInventory} from './field-record';
import type {State,Machine,Mission,Crop} from './types';
import {linkLegacyOperations} from './operation-links';
export const DEMO_BATCH='gyebuk-2026-30-v1';
export const demoEquipment=[['TR','트랙터·경운 로터리',0.4],['DR','방제 드론',2],['RP','승용 이앙기',0.3],['PS','감자 파종기',0.2],['CB','벼 콤바인',0.3],['PD','감자 굴취기',0.2],['SP','지상 방제기',0.3],['TV','장비 운송차량',0]] as const;
export const demoMachineIds=demoEquipment.flatMap(([code])=>[1,2].map(n=>`JB23${code}0${n}`));
const names=['홍길동','홍민수','홍영희','홍정수','홍순자','홍영수','홍정희','홍철수','홍미자','홍성호','홍영자','홍진수','홍숙자','홍재호','홍경자','홍동수','홍명자','홍태수','홍옥자','홍기호','홍은자','홍상수','홍복자','홍준호','홍혜자','홍석수','홍윤자','홍병호','홍선자','홍덕수'];
// Public seasonal guidance, exact dates are scenario assumptions, not local prescriptions.
export const calendarSources={rice:'https://www.rda.go.kr/board/board.do?dataNo=100000745828&mode=view&prgId=day_farmprmninfoEntry',potato:'https://www.rda.go.kr/board/board.do?boardId=farmprmninfo&dataNo=100000807551&mode=updateCnt&prgId=day_farmprmninfoEntry',pepper:'https://nongsaro.go.kr/portal/ps/psx/psxj/cropManualMain.mo?farmerMainFlag=VC011205'};
type Op=[string,string,string?];
export const seasonalOperations:Record<'rice'|'potato'|'pepper',Op[]>={
 rice:[['01-15','영농 상담·작물 및 연간계획 확인'],['03-20','종자·육묘 자재 준비'],['04-15','육묘 파종·관리'],['05-15','논 경운·정지','TR'],['05-20','기비·써레질','TR'],['05-25','모내기','RP'],['06-15','활착·물 관리 확인'],['07-05','잡초·생육 확인'],['07-25','병해충 예찰'],['08-05','예찰 후 필요 시 공동 방제','DR'],['09-10','등숙·배수 확인'],['10-05','수확 적기 확인'],['10-10','벼 수확','CB'],['10-20','건조·선별·출하 준비'],['11-05','잔재 정리','TR'],['12-05','연간 작업·정산 확인']],
 potato:[['01-15','영농 상담·작물 및 연간계획 확인'],['02-20','씨감자 준비·싹틔우기'],['03-15','밭 경운·기비','TR'],['03-20','씨감자 파종','PS'],['04-10','출아·결주 확인'],['04-25','북주기·잡초 관리'],['05-10','생육·병해충 예찰'],['05-15','예찰 후 필요 시 지상 방제','SP'],['06-05','수확 적기 확인'],['06-15','감자 굴취','PD'],['06-16','인력 수집·선별'],['06-20','저장·출하 준비'],['07-05','잔재 정리','TR'],['12-05','연간 작업·정산 확인']],
 pepper:[['01-15','영농 상담·작물 및 연간계획 확인'],['02-10','육묘 파종·관리'],['04-20','밭 경운·기비','TR'],['04-25','두둑·피복 준비'],['05-05','고추 정식'],['05-15','지주 설치·유인'],['06-10','잡초·추비 필요 확인'],['06-25','병해충 예찰'],['07-05','예찰 후 필요 시 지상 방제','SP'],['07-25','1차 선택 수확'],['08-15','2차 선택 수확'],['09-09','3차 선택 수확'],['09-25','4차 선택 수확'],['10-10','최종 수확·선별'],['11-05','지주 철거·잔재 정리'],['12-05','연간 작업·정산 확인']],
};
const uuid=(i:number)=>`20260000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
export const demoParcelsSchema=z.array(z.object({pnu:z.string().regex(/^\d{19}$/),address:z.string().min(1).max(200),area:z.number().positive().max(10000000),land:z.string().min(1),source:z.enum(['VWorld LP_PA_CBND_BUBUN','SYNTHETIC_TEST_INPUT'])})).length(30).refine(rows=>new Set(rows.map(p=>p.pnu)).size===30,'Duplicate parcel');
export type DemoParcel=z.infer<typeof demoParcelsSchema>[number];
export function demoResourceState():State{
 const machines:Machine[]=demoEquipment.flatMap(([code,name,capacity])=>[1,2].map(n=>({id:`JB23${code}0${n}`,name:`${name} ${n}호`,type:name,status:'AVAILABLE',safetyLock:false,capacityHaHour:capacity})));
 return {name:'계북면 농업지원센터',planVersion:1,fields:[],machines,missions:[],events:[],revisions:[],registered:true,planned:true,ruleVersion:DEMO_BATCH,staffCount:2,transportCount:2};
}
export function registeredDemo(input?:DemoParcel[]){
 const parsed=demoParcelsSchema.safeParse(input??requireProviderArtifact('registeredParcels'));
 if(!parsed.success)throw new ProviderArtifactError('PROVIDER_DATA_INVALID');
 const parcels=parsed.data;
 if(input===undefined&&parcels.some(p=>p.source!=='VWorld LP_PA_CBND_BUBUN'))throw new ProviderArtifactError('PROVIDER_DATA_INVALID');
 const consultations=parcels.map((p,i)=>{
  const crop=i<10?'rice':i<20?'potato':'pepper';
  return {id:uuid(i),payload:consultationSchema.parse({farmer:{name:names[i],birth:`${1946+i%24}-${String(1+i%12).padStart(2,'0')}-15`,phone:`010-0000-${String(i+1).padStart(4,'0')}`,contact:'sms'},fields:[{id:uuid(100+i),pnu:p.pnu,address:p.address,area:String(p.area),crop,mode:i%2?'delegated':'joint',tenure:'owned',ownerName:names[i],ownerPhone:'',evidence:'none',end:'',callAt:'',operator:'시연 담당자',callResult:'pending',scope:'가상 참여·가상 소유 설정. 실제 권리·동의 미확인. 면적은 지적 경계 근삿값.',verified:'pending'}],consent:false,step:3})};
 });
 const fields=fieldInventory.parse(parcels.map((p,i)=>({pnu:p.pnu,address:p.address,area:p.area,crop:consultations[i].payload.fields[0].crop,mode:i%2?'full':'joint',rights:'pending',group:'',consultationId:consultations[i].id})));
 const machines=demoResourceState().machines;
 const state:State={name:'계북면 농업지원센터',planVersion:1,fields:fields.map((f,i)=>({id:f.pnu,farmerId:consultations[i].id,name:names[i],address:f.address,area:f.area!,crop:({rice:'쌀',potato:'감자',pepper:'고추'} as const)[f.crop as 'rice'],mode:f.mode==='joint'?'공동참여형':'완전 위탁형',access:false,water:parcels[i].land==='답',confirmed:false,cluster:'',source:'DEMO_ASSUMPTION'})),machines,missions:[],events:[],revisions:[],registered:true,planned:true,ruleVersion:DEMO_BATCH,staffCount:2,transportCount:2};
 for(const [i,f] of fields.entries()){
  const crop=f.crop as 'rice'|'potato'|'pepper';
  seasonalOperations[crop].forEach(([md,label,code],j)=>{
   const date=new Date(`2026-${md}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+Math.floor((i%10)/2));
   const scheduledDate=date.toISOString().slice(0,10),start=Math.round((date.getTime()-Date.parse('2026-09-09T00:00:00Z'))/86400000)*32;
   const resourceId=code?`JB23${code}0${1+i%2}`:null;
   const m:Mission={id:`${f.pnu}-${j+1}`,fieldId:f.pnu,label,crop:state.fields[i].crop as Crop,scheduledDate,month:date.getUTCMonth()+1,owner:resourceId?'장비':i%2?'센터 인력':'농부',status:scheduledDate<'2026-09-09'?'COMPLETED':'PLANNED',resourceId,start,duration:resourceId?Math.min(24,Math.max(4,Math.ceil(f.area!/10000/(machines.find(m=>m.id===resourceId)!.capacityHaHour)*4)+2)):8,deadline:start+32,priority:label.includes('수확')?9:5,batchKey:`${f.pnu}:${j}`,staff:resourceId?1:0,transport:resourceId?1:0,...(code==='DR'?{windLimitMs:5}:{})};
   state.missions.push({...m,planningWindow:demoOperationWindow(m,m)});
  });
 }
 return {state:linkLegacyOperations(state,seasonalOperations),fields,consultations};
}
