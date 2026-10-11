import {demoSeason2026} from './demo-season';
import type {State,Crop,Mission} from './types';
export function initialState():State {
 const crops:Crop[]=['쌀','감자','고추'];
 const fields=Array.from({length:26},(_,i)=>({id:String.fromCharCode(65+i),farmerId:`F${i+1}`,name:`농지 ${String.fromCharCode(65+i)}`,address:i<3?`농소리 샘플 ${['616-4','276-1','280-2'][i]}`:`가상 농소 ${i+1}구역`,area:3000+i*120,crop:i<3?null:crops[i%3],mode:(i%2?'완전 위탁형':'공동참여형') as '완전 위탁형'|'공동참여형',access:true,water:true,confirmed:true,cluster:`G${Math.floor(i/3)}`,source:'DEMO_ASSUMPTION' as const}));
 return {name:'계북면 농업지원센터',planVersion:0,fields,machines:[{id:'D1',name:'공동 방제드론 01',type:'방제드론',status:'AVAILABLE',safetyLock:false,capacityHaHour:2},{id:'D2',name:'공동 방제드론 02',type:'방제드론',status:'AVAILABLE',safetyLock:false,capacityHaHour:2},{id:'P1',name:'자동화 예정 파종기',type:'파종기',status:'AVAILABLE',safetyLock:false,capacityHaHour:0.8},{id:'H1',name:'자동화 예정 수확기',type:'수확기',status:'MAINTENANCE',safetyLock:false,capacityHaHour:0.6}],missions:[],events:[],revisions:[],registered:false,planned:false,ruleVersion:'DEMO_RULES_1',transportCount:1,staffCount:2};
}
export function annualMissions(s:State):Mission[]{
 const labels:Partial<Record<Crop,string[]>>={'쌀':['육묘 준비','논 준비','모내기','생육 확인','공동 방제','물 관리','수확 준비','수확'],'감자':['씨감자 준비','밭 준비','파종','북주기','공동 방제','생육 확인','수확 준비','수확'],'고추':['모종 준비','밭 준비','정식','지주 유인','공동 방제','생육 확인','수확 준비','수확']};
 const missions=s.fields.flatMap((f,i)=>Array.from({length:21},(_,j)=>{
  const crop=f.crop!;if(!labels[crop])throw Error('기존 3작물 입력 전용'); const spray=j===4; const owner=spray?'장비':(f.mode==='완전 위탁형'?'센터 인력':'농부');
  // Same crop / product / weather window / nearby cluster, never adjacency alone.
  return {id:`${f.id}-${j+1}`,fieldId:f.id,label:labels[crop][j%8],crop,month:spray?6:3+Math.floor(j*8/21),owner,status:'PLANNED',resourceId:spray?(i%2?'D2':'D1'):null,start:spray?i*2:0,duration:spray?Math.ceil((f.area/10000/2*60+15)/15):2,deadline:160,priority:spray?8:3,batchKey:`${f.cluster}:${crop}:demo-product-1:6`,staff:spray?1:0,transport:spray?1:0} as Mission;
 }));
 const ground=missions.find(m=>m.id==='B-2')!;
 Object.assign(ground,{label:'지상 파종 (모의)',month:6,owner:'장비',resourceId:'P1',start:0,duration:4,deadline:32,priority:9,batchKey:'B:ground:seed',staff:1,transport:1,windLimitMs:12});
 return demoSeason2026({...s,missions}).missions;
}
