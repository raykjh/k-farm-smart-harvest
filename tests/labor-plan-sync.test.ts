import {it,expect,vi} from 'vitest';
import {reconcileLaborPlan} from '../lib/labor-plan-sync';
import {respond,type LaborOps} from '../lib/labor-operations';
it('invalidates old attendance, invites again and allocates only after a new response',async()=>{
 let payload:LaborOps={people:[{id:'worker',name:'홍테스트',active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:0,endMinute:1440,workCodes:['*'],usesApp:true} as any],jobs:[{id:'old',missionId:'task',task:'수확',address:'test',date:'2027-05-01',startMinute:480,durationMinutes:60,count:1,workCode:'general',sourceHash:'old',pay:'협의',status:'OPEN',invited:['worker'],responses:{worker:'PHONE'},assigned:['worker'],distances:{worker:1},manual:null,worked:[]}],penalties:[],notices:[]};
 const tx={$executeRaw:vi.fn(),workRecord:{findMany:vi.fn(async()=>[]),findUnique:vi.fn(async()=>({payload:structuredClone(payload)})),update:vi.fn(async({data}:any)=>{payload=data.payload})}} as any;
 const state={fields:[],missions:[{id:'task',fieldId:'field',label:'수확',owner:'센터 인력',staff:1,status:'PLANNED',scheduledDate:'2027-05-02',resourceId:null,start:0,duration:4}]} as any;
 await reconcileLaborPlan(tx,'demo',state);
 expect(payload.jobs[0].status).toBe('STALE');expect(payload.jobs[0].responses.worker).toBe('PHONE');
 const next=payload.jobs[1];expect(next.responses).toEqual({});expect(next.assigned).toEqual([]);expect(payload.notices.map(n=>n.type)).toEqual(['CANCELLED','RECONFIRM']);
 expect(()=>respond(payload,'old','worker','APP',new Date().toISOString())).toThrow();
 respond(payload,next.id,'worker','APP',new Date().toISOString());expect(next.assigned).toEqual(['worker']);
 await reconcileLaborPlan(tx,'demo',state);expect(payload.jobs).toHaveLength(2);
});
