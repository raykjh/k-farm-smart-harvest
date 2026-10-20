import type {NationalCenterInput,NationalRecord} from '../lib/national-overview';
import {cropReferences,estimateProduction} from '../lib/crop-reference';
import type {Mission,State} from '../lib/types';

/**
 * Deterministic load data, not an official sample or AI-approved operation.
 * All identities, geometry and task dates are synthetic. Never seed an existing DB.
 * Crop weights are illustrative (50/30/20), not national production proportions.
 */
export function nationalScaleFixture(count:number,centerCount:number){
 if(!Number.isInteger(count)||count<1||count>30000||!Number.isInteger(centerCount)||centerCount<1||centerCount>100||centerCount>count)throw Error('Unsupported load size');
 const batch='national-load-20261020',centers:NationalCenterInput[]=[],records:NationalRecord[]=[];
 const expectations={cultivations:count,approvedAreaM2:0,harvestCompletedAreaM2:0,overdue:0,missingYield:0,missions:0,evidence:0,crops:{rice:0,potato:0,pepper:0}};
 for(let i=0;i<centerCount;i++){
  const id='load-center-'+String(i+1).padStart(3,'0');
  const state:State={name:'규모 검증 센터 '+(i+1),fields:[],missions:[],machines:[],events:[],revisions:[],planVersion:1,staffCount:0,transportCount:0,ruleVersion:'LOAD_FIXTURE_ONLY',registered:true,planned:true};
  centers.push({id,state,version:1});
  records.push({workspace:'center:'+id,kind:'centerSettings',id:'current',payload:{location:{longitude:127.1+(i%10)*0.05,latitude:35.6+Math.floor(i/10)*0.05},sourceBatchId:batch}});
 }
 for(let i=0;i<count;i++){
  const center=centers[i%centerCount],workspace='center:'+center.id,local=Math.floor(i/centerCount);
  const slot=(local+(i%centerCount)*3)%10,crop=slot<5?'rice':slot<8?'potato':'pepper';
  const reference=cropReferences.find(r=>r.id===(crop==='rice'?'rice-paddy':crop==='potato'?'potato-spring':'pepper-statistical'))!;
  const pnu='52740'+String(i+1).padStart(14,'0'),id=batch+'-cycle-'+i,area=1000+(i%5)*100;
  const complete=local%5===0,missingYield=i%20===0;
  const harvest=complete?'2027-05-10':'2027-10-10',tasks:any[]=[];
  center.state.fields.push({id:pnu,farmerId:batch+'-owner-'+i,name:'LOAD_PRIVATE_NAME',address:'LOAD_PRIVATE_ADDRESS',area,crop:reference.crop,mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'',source:'DEMO_ASSUMPTION',demoBatchId:batch});
  for(let j=0;j<6;j++){
   const taskId=id+':step-'+j,date=complete?'2027-05-10':j<2?'2027-05-10':'2027-10-10';
   tasks.push({id:taskId,operationCode:j===5?'harvest':'step-'+j,window:{from:date,to:date}});
   const mission:Mission&{cultivationId:string}={id:taskId,fieldId:pnu,label:j===5?'수확':'규모 검증 작업',crop:reference.crop,scheduledDate:date,month:Number(date.slice(5,7)),owner:'센터 인력',status:'PLANNED',resourceId:null,start:j*4,duration:4,deadline:32,priority:1,batchKey:id,staff:1,transport:0,cultivationId:id};
   center.state.missions.push(mission);
   if(complete){
    const recordId=taskId+':execution';
    records.push({workspace,kind:'taskExecutionAssessment',id:recordId,payload:{missionId:taskId,source:'DEMO_SIMULATION',plannedDate:date,assessment:'SIMULATED_COMPLETED',simulatedStartedAt:date+'T09:00:00+09:00',simulatedFinishedAt:date+'T10:00:00+09:00',recordId,version:1,updatedAt:'2027-05-11T00:00:00Z',sourceBatchId:batch}});
    expectations.evidence++;
   }else if(j<2)expectations.overdue++;
   expectations.missions++;
  }
  records.push({workspace,kind:'cultivation',id,payload:{id,pnu,crop,start:'2027-03-01',end:harvest,sourceBatchId:batch}});
  records.push({workspace,kind:'cultivationPlan',id,payload:{context:{},plots:[{pnu,area,referenceId:reference.id,...missingYield?{}:{yieldRange:estimateProduction(area,reference)},tasks}],sourceBatchId:batch}});
  expectations.crops[crop]++;expectations.approvedAreaM2+=area;
  if(complete)expectations.harvestCompletedAreaM2+=area;
  if(missingYield)expectations.missingYield++;
 }
 return {batch,centers,records,expectations};
}
