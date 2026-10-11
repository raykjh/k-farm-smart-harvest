import {test,expect} from './authenticated-test';
import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
test('one-click incidents use common scheduling and labor paths',async({page,request})=>{
 test.skip(process.env.KFARM_UI_E2E!=='1','Isolated DB required');test.setTimeout(90000);page.setDefaultTimeout(15000);
 const db=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_ui_e2e'});
 try{
 const row=await db.center.findUniqueOrThrow({where:{id:'demo'}}),s=row.state as any;expect((await(await request.get('/api/workspace')).json()).state).toEqual(s);expect(s.missions).toHaveLength(0);
 const date=(n:number)=>new Date(Date.now()+9*3600000+n*86400000).toISOString().slice(0,10),offset=(d:string)=>Math.round((Date.parse(d)-Date.parse('2026-09-09'))/86400000)*32;
 s.fields=[{id:'f',farmerId:'farmer-test',name:'홍상황',address:'가상 필지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'',source:'REGISTERED'}];
 const task=(id:string,resourceId:string|null,start=0)=>({id,fieldId:'f',crop:'쌀',label:resourceId?.includes('DR')?'드론 방제':'밭 정리',scheduledDate:date(1),month:Number(date(1).slice(5,7)),owner:resourceId?'장비':'센터 인력',status:'PLANNED',resourceId,start:offset(date(1))+start,duration:4,deadline:offset(date(10))+32,priority:5,batchKey:id,staff:1,transport:resourceId?1:0,predecessorMissionIds:[],planningWindow:{from:date(1),to:date(10),duration:4,windLimitMs:resourceId?.includes('DR')?5:12,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'}});
 s.missions=[task('wind-test','JB23DR01'),task('ground-test','JB23TR01',4)];await db.center.update({where:{id:'demo'},data:{state:s}});
 await page.goto('/');const panel=page.getByTestId('incident-console');await panel.locator('summary').first().click();await panel.getByLabel('대상 날짜',{exact:true}).fill(date(1));
 const click=async()=>{const wait=page.waitForResponse(r=>r.url().includes('/api/incidents')&&r.request().method()==='POST');await panel.getByRole('button',{name:'상황 발생 · 대응 계산',exact:true}).click();const r=await wait;expect(r.status()).toBe(200);return r.json()};
 const wind=await click();expect(wind.ids).toEqual(['wind-test']);expect(wind.source).toBe('RULES_AND_SOLVER');expect(wind.diff.every((d:any)=>d.id==='wind-test')).toBe(true);
 expect((await(await request.get('/api/workspace')).json()).state.missions).toEqual(s.missions);
 const approved=page.waitForResponse(r=>r.url().includes('/api/replanning')&&r.request().method()==='POST');await panel.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();expect((await approved).status()).toBe(200);
  const after=(await(await request.get('/api/workspace')).json()).state;expect(after.missions.find((m:any)=>m.id==='ground-test')).toEqual(s.missions[1]);expect(after.missions[0].scheduledDate).not.toBe(date(1));
 await panel.getByLabel('발생 상황',{exact:true}).selectOption('DROUGHT');expect((await click()).status).toBe('REVIEW_REQUIRED');expect((await(await request.get('/api/workspace')).json()).state).toEqual(after);
 await panel.getByLabel('발생 상황',{exact:true}).selectOption('RAIN');const rain=await click();expect(rain.ids).toEqual(['ground-test']);
 await panel.getByLabel('발생 상황',{exact:true}).selectOption('BREAKDOWN');await panel.getByLabel('고장 대상 장비',{exact:true}).selectOption('JB23TR01');const broken=await click();expect(broken.ids).toEqual(['ground-test']);expect((await(await request.get('/api/workspace')).json()).state.machines.find((m:any)=>m.id==='JB23TR01').status).toBe('MAINTENANCE');
 // Isolated labor fixture: two confirmed volunteers, one current assignee.
 const current=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any,m={...task('labor-event',null),scheduledDate:date(5),start:offset(date(5)),operationCode:'finish'};current.missions.push(m);await db.center.update({where:{id:'demo'},data:{state:current}});await db.workRecord.create({data:{workspace:'sandbox',kind:'laborDemand',id:m.id,payload:{missionId:m.id}}});
 const a=crypto.randomUUID(),b=crypto.randomUUID(),jobId=crypto.randomUUID(),v={id:m.id,missionId:m.id,task:m.label,address:'가상 필지',date:date(5),startMinute:480,durationMinutes:60,count:1,workCode:'finish',held:false};
 const person=(id:string)=>({id,name:id===a?'홍첫째':'홍대기',birth:'1960-01-01',phone:'000',address:'가상',registeredFarmer:false,usesApp:false,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:1020,workCodes:['*'],active:true});
 await db.workRecord.create({data:{workspace:'sandbox',kind:'laborOperations',id:'current',payload:{people:[person(a),person(b)],jobs:[{...v,id:jobId,sourceHash:createHash('sha256').update(JSON.stringify(v)).digest('hex'),pay:'가상',status:'OPEN',invited:[a,b],responses:{[a]:'PHONE',[b]:'PHONE'},distances:{[a]:1,[b]:2},assigned:[a],manual:null,worked:[]}],penalties:[],notices:[]}}});
 await page.reload();await panel.locator('summary').first().click();await panel.getByLabel('대상 날짜',{exact:true}).fill(date(5));await panel.getByLabel('발생 상황',{exact:true}).selectOption('ABSENCE');await panel.getByLabel('인력 작업',{exact:true}).selectOption(jobId);await panel.getByLabel('불참 배정자',{exact:true}).selectOption(a);const absence=await click();expect(absence.assigned).toEqual([b]);expect(absence.shortage).toBe(0);
 await page.screenshot({path:'test-results/incident-response.png',fullPage:true});expect(await db.workRecord.count({where:{kind:'incident'}})).toBe(5);
 }finally{await db.$disconnect()}
});
