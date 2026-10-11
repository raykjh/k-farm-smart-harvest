import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry} from '../lib/center-registry';
import {dateSlot} from '../lib/scheduling-engine';
import {recordSpace} from '../lib/workspace';
import {publicYieldCriteria,yieldPolicyDraft} from '../lib/public-crop-criteria';
import {resetFourCenterFixture,fourCenterRegistration,fourCenterTestUrl,fixtureToday,fixtureDay as day} from '../tests/four-center-fixture';
import type {State} from '../lib/types';

test.skip(process.env.KFARM_CENTERS_E2E!=='1','Explicit isolated DB run required');
test.use({actionTimeout:15000});
test.beforeAll(async()=>{
 await resetFourCenterFixture();
 if(process.env.DATABASE_URL!==fourCenterTestUrl)throw Error('Dedicated DB required');
 for(const c of centerRegistry){
  const row=await db.center.findUniqueOrThrow({where:{id:c.id}}),s=row.state as unknown as State;
  s.machines.forEach(m=>m.compatibleCrops=['rice']);
  s.crewCapacity={operators:1,workers:c.id==='janggye'?1:3};s.staffCount=s.crewCapacity.operators+s.crewCapacity.workers;
  // Synthetic existing work exhausts Janggye's own ordinary crew in the seed window.
  // New applications must preserve this work and use confirmed adjacent support.
  if(c.id==='janggye')for(let n=8;n<=12;n++){
   const date=day(`04-${String(n).padStart(2,'0')}`);
   s.missions.push({id:'existing-crew-'+n,fieldId:'past-field',label:'기존 확정 인력 작업',crop:'쌀',scheduledDate:date,month:4,owner:'센터 인력',status:'PLANNED',resourceId:null,start:dateSlot(date)-dateSlot('2026-09-09'),duration:32,deadline:dateSlot(date)+32,priority:1,batchKey:'existing-crew-'+n,staff:1,ordinaryWorkers:1,machineOperators:0,transport:0});
  }
  await db.center.update({where:{id:c.id},data:{state:JSON.parse(JSON.stringify(s))}});
 }
});

test('public criteria -> four sequential intakes -> shared capacity -> approval -> packets -> replan and final notices',async({playwright,browser},info)=>{
 test.setTimeout(300000);
 const clients:Record<string,APIRequestContext>={},tokens:Record<string,string>={},web:BrowserContext[]=[];
 for(const c of [...centerRegistry,{id:'global',township:'총괄'}]){
  const id=randomUUID(),token=randomBytes(32).toString('hex');tokens[c.id]=token;
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'criteria-e2e-'+id,name:c.township+' 검증 담당자',centerId:c.id==='global'?null:c.id,role:c.id==='global'?'SUPER_ADMIN':'CENTER_ADMIN',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
  clients[c.id]=await playwright.request.newContext({baseURL:'http://127.0.0.1:3100',extraHTTPHeaders:{cookie:'kfarm_session='+token,origin:'http://127.0.0.1:3100'}});
 }
 const post=async(c:string,path:string,data:unknown,code=200)=>{const r=await clients[c].post(path,{data}),b=await r.json();expect(r.status(),JSON.stringify(b)).toBe(code);return b};
 const get=async(c:string,path:string)=>{const r=await clients[c].get(path);expect(r.ok(),await r.text()).toBe(true);return r.json()};
 const open=async(c:string,path:string)=>{const ctx=await browser.newContext({viewport:{width:1440,height:1050},extraHTTPHeaders:{origin:'http://127.0.0.1:3100'}});web.push(ctx);await ctx.addCookies([{name:'kfarm_session',value:tokens[c],domain:'127.0.0.1',path:'/'}]);const page=await ctx.newPage();await page.goto('http://127.0.0.1:3100'+path);return page};
 const labor=async(c:string,data:object)=>post(c,'/api/labor-operations',{...data,version:(await get(c,'/api/labor-operations')).version,requestId:randomUUID()});
 const calls=await db.aiCall.count(),before=await db.center.findMany(),existing=(before.find(c=>c.id==='janggye')!.state as unknown as State).missions;
 try{
  // Review official facts, explicitly save policy; merely browsing must not activate it.
  const root=await open('global','/crop-info?crop=apple'),panel=root.getByTestId('production-coordination');
  await expect(root.getByRole('article')).toContainText('1,912–1,933 kg / 1,000 m²');
  await panel.locator('summary').first().click();await panel.getByTestId('public-criteria').locator('summary').click();
  expect((await get('global','/api/production-coordination')).policy.yields).toEqual([]);
  await panel.getByRole('button',{name:'쌀 기준 불러오기',exact:true}).click();
  await expect(panel.getByLabel('하한 kg / 1,000m²',{exact:true})).toHaveValue('514');
  await expect(panel.getByLabel('유효 종료일',{exact:true})).toHaveValue('');
  await panel.getByLabel('유효 종료일',{exact:true}).fill(day('12-31'));
  await panel.getByRole('button',{name:'기준 저장',exact:true}).click();
  await expect.poll(async()=>(await get('global','/api/production-coordination')).policy.yields.length).toBe(1);
  let policy=await get('global','/api/production-coordination');
  await post('global','/api/production-coordination',{version:policy.version,policy:{...policy.policy,yields:publicYieldCriteria.map(r=>({...yieldPolicyDraft(r.id),validUntil:day('12-31')}))}});
  await post('global','/api/production-coordination',{version:policy.version,policy:policy.policy},409);
  await root.reload();await panel.locator('summary').first().click();await panel.getByTestId('public-criteria').locator('summary').click();
  await root.screenshot({path:info.outputPath('public-yield-criteria.png'),fullPage:true});
  for(const c of centerRegistry){
   const page=await open(c.id,'/crop-info'),p=page.getByTestId('production-coordination');
   await p.locator('summary').first().click();await p.getByTestId('public-criteria').locator('summary').click();
   await expect(p.getByRole('button',{name:'쌀 기준 불러오기',exact:true})).toHaveCount(0);
   await p.getByRole('button',{name:'고추 검토 후보 불러오기',exact:true}).click();
   await expect(p.getByLabel('우선점수 (0–5)',{exact:true})).toHaveValue('0');
   await p.getByLabel('유효 종료일',{exact:true}).fill(day('12-31'));await p.getByRole('button',{name:'기준 저장',exact:true}).click();
   await expect.poll(async()=>(await get(c.id,'/api/production-coordination')).policy.specialties.some((s:any)=>s.centerId===c.id&&s.bonus===0)).toBe(true);
  }
  policy=await get('global','/api/production-coordination');expect(policy.policy.targets).toEqual([]);expect(policy.policy.specialties).toHaveLength(4);
  await post('demo','/api/production-coordination',{version:policy.version,policy:{...policy.policy,yields:[]}},409);
  // Named, consented support is reserved before intake. No unknown staff count becomes a person.
  const workerId=randomUUID();
  await labor('demo',{action:'person',testDataOnly:true,person:{id:workerId,name:'홍지원',birth:'1965-01-01',phone:'000-0000-0000',address:'계북면 격리 입력',registeredFarmer:false,usesApp:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['seed'],active:true}});
  const supportIds:string[]=[];
  for(const md of ['04-08','04-09']){
   const id=randomUUID();supportIds.push(id);
   await post('demo','/api/labor-capacity',{action:'offer',requestId:id,rosterVersion:(await get('demo','/api/labor-capacity')).rosterVersion,window:{workerId,borrowerCenterId:'janggye',date:day(md),startMinute:480,endMinute:960,travelMinutes:30,workCodes:['seed'],response:'PHONE',consent:true,reason:'격리 검증용 본인 확인 지원'}});
  }
  const supportPage=await open('janggye','/?tab=labor'),supportPanel=supportPage.getByTestId('labor-capacity');
  await supportPanel.locator('summary').first().click();await supportPanel.getByLabel('제안·확정·취소 사유',{exact:true}).fill('작업 수요와 이동시간 확인');
  for(const md of ['04-08','04-09']){const row=supportPanel.locator('tbody tr').filter({hasText:day(md)});await row.getByRole('button',{name:'지원시간 확정',exact:true}).click();await expect(row).toContainText('확정');}
  const rejected={action:'offer',requestId:randomUUID(),rosterVersion:(await get('demo','/api/labor-capacity')).rosterVersion,window:{workerId,borrowerCenterId:'gyenam',date:day('04-10'),startMinute:480,endMinute:960,travelMinutes:30,workCodes:['seed'],response:'PHONE',consent:true,reason:'비인접 센터 차단 확인'}};
  await post('demo','/api/labor-capacity',rejected,409);
  const loan={id:randomUUID(),version:0,machineId:'JB23TR01',ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:day('05-01'),usableUntil:day('05-31'),status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
  await post('janggye','/api/center-resources',loan);await post('demo','/api/center-resources',{...loan,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true});
  // Four ordinary registrations, real saved drafts and approval UI, no intercepted APIs.
  const pnuByCenter:Record<string,string>={};
  for(const [i,c] of centerRegistry.entries()){
   const input=fourCenterRegistration(i,randomUUID());pnuByCenter[c.id]=input.consultation.fields[0].pnu;
   await post(c.id,'/api/registrations',input);
   const draft=(await post(c.id,'/api/continuous-production',{action:'refresh'})).view;
   expect(draft.items[0].status,JSON.stringify(draft.items)).toBe('REVIEW');
   const page=await open(c.id,'/?tab=production'),p=page.getByTestId('continuous-production');
   await expect(p).toContainText('새 계획 확인');await p.getByText('작업·장비·인력 계획 보기',{exact:false}).click();
   await p.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();await p.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
   await p.getByRole('button',{name:'선택 1필지 계획 일괄 확정',exact:true}).click();await expect(p).toContainText('다음 재배 연결됨');
   const state=(await get(c.id,'/api/workspace')).state;expect(state.missions.filter((m:any)=>m.fieldId===pnuByCenter[c.id])).toHaveLength(8);
   await page.screenshot({path:info.outputPath(`${c.id}-approved.png`),fullPage:true});
  }
  const seed=(await get('janggye','/api/workspace')).state.missions.find((m:any)=>m.fieldId===pnuByCenter.janggye&&m.operationCode==='seed');
  expect(seed).toMatchObject({scheduledDate:day('04-08'),laborSupportIds:[supportIds[0]]});
  // Capacity is not attendance. Open the actual work and obtain a per-job response.
  await labor('janggye',{action:'open',demandId:seed.id,pay:'격리 검증용 근무 조건',simpleWorkConfirmed:true});
  const job=(await get('janggye','/api/labor-operations')).payload.jobs.find((j:any)=>j.missionId===seed.id);
  const shareId=randomUUID();
  await post('demo','/api/labor-sharing',{action:'offer',requestId:shareId,version:(await get('demo','/api/labor-operations')).version,borrowerCenterId:'janggye',jobId:job.id,sourceHash:job.sourceHash,workerId,response:'PHONE',travelMinutes:30,distanceKm:5,consent:true});
  const move=await post('janggye','/api/replanning',{action:'preview',ids:[seed.id],preferred:day('04-09'),scope:'PRESERVE',reason:'작업일 변경 및 참석 재확인',decisionSource:'DEVELOPMENT_REVIEW'});
  expect(move.status,JSON.stringify(move)).toBe('FEASIBLE');await post('janggye','/api/replanning',{action:'approve',proposalId:move.proposalId});
  expect((await post('janggye','/api/replanning',{action:'approve',proposalId:move.proposalId})).alreadyApplied).toBe(true);
  const jobs=(await get('janggye','/api/labor-operations')).payload.jobs,renewed=jobs.find((j:any)=>j.replacesJobId===job.id);
  expect(jobs.find((j:any)=>j.id===job.id).status).toBe('STALE');expect(renewed.responses).toEqual({});
  expect((await get('janggye','/api/workspace')).state.missions.find((m:any)=>m.id===seed.id)).toMatchObject({scheduledDate:day('04-09'),laborSupportIds:[supportIds[1]]});
  for(const c of ['demo','janggye'])expect((await get(c,'/api/labor-capacity')).notices.some((n:any)=>n.event==='PLAN_CHANGED'&&n.detail.attendanceReconfirmationRequired)).toBe(true);
  await post('demo','/api/labor-sharing',{action:'offer',requestId:randomUUID(),version:(await get('demo','/api/labor-operations')).version,borrowerCenterId:'janggye',jobId:renewed.id,sourceHash:renewed.sourceHash,workerId,response:'APP',travelMinutes:30,distanceKm:5,consent:true});
  expect((await get('janggye','/api/labor-sharing')).offers.some((s:any)=>s.jobId===renewed.id&&s.status==='ASSIGNED')).toBe(true);
  // Real packet persistence and stale-version invalidation after a wind replan.
  await post('demo','/api/equipment-missions',{action:'area',version:0,area:{pnu:pnuByCenter.demo,geometry:{type:'Polygon',coordinates:[[[127.60,35.78],[127.601,35.78],[127.601,35.781],[127.60,35.78]]]},source:'OPERATOR_DRAWN',reviewedOn:fixtureToday,accessAndExclusionsReviewed:true,note:'실측이 아닌 격리 검증용 작업구역 입력'}});
  expect((await get('demo','/api/equipment-missions')).tasks[0].blockers).toContain('FIELD_ACCESS_REVIEW_REQUIRED');
  const equipmentPage=await open('demo','/?tab=equipment'),equipment=equipmentPage.getByTestId('equipment-missions');
  await equipment.locator('summary').first().click();await equipment.getByText('현장 확인 작업구역 저장',{exact:true}).click();
  await equipment.getByLabel('등록 농지',{exact:true}).selectOption(pnuByCenter.demo);
  await equipment.getByRole('checkbox',{name:'진입로·위험구역·제외구역을 별도로 확인했습니다.',exact:true}).check();
  await equipment.getByRole('checkbox',{name:'작업 장비가 농지에 안전하게 진입 가능한지 현장 확인했습니다.',exact:true}).check();
  await equipment.getByRole('button',{name:'작업구역 저장',exact:true}).click();
  await expect.poll(async()=>(await get('demo','/api/equipment-missions')).areas[0].machineAccessConfirmed).toBe(true);
  expect((await get('demo','/api/fields')).payload[0].rights).toBe('pending');
  const packet=(await get('demo','/api/equipment-missions')).tasks.find((t:any)=>t.date===day('07-01')&&t.equipmentId.includes('DR'));
  expect(packet.ready,JSON.stringify(packet.blockers)).toBe(true);
  const taskPanel=equipment.locator('details').filter({has:equipmentPage.locator('summary',{hasText:`${packet.date} · ${packet.label} · ${packet.equipmentId}`})}).first();
  await taskPanel.locator('summary').first().click();await taskPanel.getByRole('button',{name:'전달자료 생성',exact:true}).click();await expect(taskPanel).toContainText('PREPARED');
  await taskPanel.getByRole('button',{name:'내부 연결 수신 확인',exact:true}).click();await expect(taskPanel).toContainText('LOCAL_RECEIPT_RECORDED');
  await equipmentPage.screenshot({path:info.outputPath('equipment-local-receipt.png'),fullPage:true});
  const receipt=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'equipmentMission',id:packet.id}}})).payload;
  expect(receipt).toMatchObject({hardwareSent:false,executionAuthorized:false});
  const wind=await post('demo','/api/incidents',{id:randomUUID(),kind:'WIND',day:day('07-01')});expect(wind.status).toBe('FEASIBLE');await post('demo','/api/replanning',{action:'approve',proposalId:wind.proposalId});
  const stale=(await get('demo','/api/equipment-missions')).tasks.find((t:any)=>t.id===packet.id);expect(stale.status).toBe('STALE');expect(stale.fingerprint).not.toBe(packet.fingerprint);
  await post('demo','/api/equipment-missions',{action:'localReceipt',missionId:packet.id,fingerprint:packet.fingerprint,requestId:randomUUID()},409);
  await post('demo','/api/equipment-missions',{action:'prepare',missionId:packet.id,fingerprint:stale.fingerprint,requestId:randomUUID()});
  // Prior work, other tenants, no fabricated national coverage, and persisted local delivery.
  for(const m of existing)expect((await get('janggye','/api/workspace')).state.missions.find((n:any)=>n.id===m.id)).toEqual(m);
  for(const c of centerRegistry){
   await post(c.id,'/api/operations',{action:'deliver',key:randomUUID()});
   const result=await get(c.id,'/api/workspace');expect(result.notices.some((n:any)=>n.status==='DELIVERED')).toBe(true);expect(result.notices.every((n:any)=>['DELIVERED','SUPERSEDED'].includes(n.status))).toBe(true);
   expect(result.state.missions.find((m:any)=>m.id==='past-record')).toEqual((before.find(b=>b.id===c.id)!.state as unknown as State).missions[0]);
   expect((await get(c.id,'/api/fields')).payload).toHaveLength(1);
  }
  const totals=await get('global','/api/production-coordination');expect(totals.contributionCount).toBe(4);expect(totals.totals).toHaveLength(1);expect(totals.totals[0].kg).toEqual({low:2056,high:2120});
  expect(await db.aiCall.count()).toBe(calls);
  await info.attach('four-center-coordination-evidence',{body:JSON.stringify({database:'kfarm_centers_e2e',apiInterception:false,centers:4,cultivations:4,yieldSources:12,countyCandidates:4,automaticRegionalBonus:0,supplyTargetEstablished:false,adjacentCapacityInInitialAndReplanning:true,individualAttendanceReconfirmed:true,packetInvalidatedByPlanChange:true,paidInference:false,externalSms:false,hardwareSent:false}),contentType:'application/json'});
 }finally{for(const c of web)await c.close();for(const c of Object.values(clients))await c.dispose()}
});
