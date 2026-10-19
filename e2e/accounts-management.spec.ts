import {test,expect} from './authenticated-test';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import type {AccountApplication} from '../lib/account-applications';

test.use({authRole:'SUPER_ADMIN',viewport:{width:1440,height:1100}});
test('review applications, create, edit, reset and delete accounts through the real UI and isolated DB',async({page})=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated account review DB only');
 const tag=randomUUID().slice(0,8),applications:AccountApplication[]=[],usernames:string[]=['staff-'+tag];let actorId='';
 const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
 for(let i=0;i<8;i++)applications.push({id:randomUUID(),username:`apply-${tag}-${i}`,name:`홍길${String.fromCharCode(0xb3d9+i)}`,birth:'1980-03-04',phone:'000-0000-0000',affiliation:i%2?'계북면 농업지원센터':'장계면 농업지원센터',passwordHash:'NO_PASSWORD_LOGIN',status:'PENDING',createdAt:new Date().toISOString()});
 usernames.push(...applications.map(a=>a.username));
 await db.workRecord.createMany({data:applications.map(a=>({...authKey('application',a.id),payload:a}))});
 try{
  await page.goto('/accounts');await expect(page.getByRole('heading',{name:'계정 관리',exact:true})).toBeVisible();
  actorId=await page.evaluate(async()=> (await (await fetch('/api/auth')).json()).user.id);
  const pending=page.getByTestId('pending-applications');await expect(pending.locator('tbody tr')).toHaveCount(8);
  const box=await pending.boundingBox();expect(box!.height).toBeLessThanOrEqual(320);
  expect(await pending.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  expect(await pending.getByRole('heading').count()).toBe(0);
  await expect(page.getByText('총괄 계정은 공통 기준·계정·집계를 관리합니다.',{exact:false})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'공통 작물 기준',exact:true})).toHaveCount(0);
  await expect(page.getByText('농부 상담·농지는 담당 면에서 관리하고',{exact:false})).toHaveCount(0);
  await page.screenshot({path:'.data/validation/accounts-review-20261011-desktop.png',fullPage:true});
  const a=applications[0],first=page.locator(`[data-application-id="${a.id}"]`);
  await expect(first.getByLabel(a.username+' 담당 센터')).toHaveValue('janggye');
  await first.getByRole('button',{name:'상세',exact:true}).click();const applicationDialog=page.getByRole('dialog');
  await expect(applicationDialog.getByText(a.birth,{exact:true})).toBeVisible();await expect(applicationDialog.getByText(a.phone,{exact:true})).toBeVisible();
  await applicationDialog.getByLabel(a.username+' 권한').selectOption('CENTER_ADMIN');
  await applicationDialog.getByRole('button',{name:'승인',exact:true}).click();await expect(applicationDialog).toHaveCount(0);await expect(first).toHaveCount(0);
  const approved=await db.workRecord.findFirstOrThrow({where:{workspace:'auth',kind:'user',payload:{path:['username'],equals:a.username}}});
  expect(approved.payload).toMatchObject({centerId:'janggye',role:'CENTER_ADMIN',birth:a.birth,phone:a.phone});
  await page.locator(`[data-application-id="${applications[1].id}"]`).getByRole('button',{name:'거부',exact:true}).click();
  await page.getByRole('dialog').getByLabel('거부 사유 (선택)').fill('소속 확인 후 재신청');
  await page.getByRole('dialog').getByRole('button',{name:'거부 확인'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('application',applications[1].id)}})).payload).toMatchObject({status:'REJECTED',passwordHash:''});
  const form=page.getByRole('region',{name:'개인 계정 추가'});
  await form.getByLabel('아이디',{exact:true}).fill(usernames[0]);await form.getByLabel('이름',{exact:true}).fill('홍지원');await form.getByLabel('생년월일',{exact:true}).fill('1985-05-20');await form.getByLabel('연락처',{exact:true}).fill('000-0000-0000');
  await form.getByLabel('담당 센터',{exact:true}).selectOption('demo');await form.getByLabel('비밀번호 (12자 이상)',{exact:true}).fill('Synthetic-Account-983!');
  await form.getByRole('button',{name:'계정 생성'}).click();await expect(page.getByRole('cell',{name:usernames[0],exact:true})).toBeVisible();
  const staff=await db.workRecord.findFirstOrThrow({where:{workspace:'auth',kind:'user',payload:{path:['username'],equals:usernames[0]}}});
  const row=page.locator(`[data-account-id="${staff.id}"]`);await row.getByRole('button',{name:'상세',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('아이디',{exact:true})).toHaveAttribute('readonly','');
  await dialog.getByLabel('이름',{exact:true}).fill('홍지수');await dialog.getByRole('combobox',{name:'상태',exact:true}).selectOption('false');await page.screenshot({path:'.data/validation/accounts-review-20261011-detail.png'});await dialog.getByRole('button',{name:'변경 저장'}).click();await expect(dialog).toHaveCount(0);await expect(row.getByText('중지',{exact:true})).toBeVisible();await expect(row.getByText('홍지수')).toBeVisible();
  await row.getByRole('button',{name:'비밀번호 재설정'}).click();await page.getByRole('dialog').getByLabel('새 임시 비밀번호',{exact:false}).fill('Replacement-Password-371!');await page.getByRole('dialog').getByRole('button',{name:'임시 비밀번호 저장'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',staff.id)}})).payload).toMatchObject({mustChangePassword:true,enabled:false});
  await row.getByRole('button',{name:'상세',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'계정 삭제'}).click();await expect(page.getByRole('dialog').getByText('기존 업무·승인 이력은 보존',{exact:false})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'삭제 확인'}).click();await expect(row).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  const self=page.locator(`[data-account-id="${actorId}"]`);await self.getByRole('button',{name:'상세',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'계정 삭제'})).toHaveCount(0);await expect(page.getByRole('dialog').getByRole('combobox',{name:'권한',exact:true})).toBeDisabled();await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).last().click();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'.data/validation/accounts-review-20261011-mobile.png',fullPage:true});
  await page.getByLabel('언어 / Language',{exact:true}).selectOption('en');await expect(page.getByRole('heading',{name:'Accounts',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Create account',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:/Account applications/})).toBeVisible();
  expect(pageErrors).toEqual([]);
 }finally{
  const users=await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}}),ids=users.filter(r=>usernames.includes((r.payload as {username:string}).username)).map(r=>r.id);
  await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'application',id:{in:applications.map(a=>a.id)}},{kind:'user',id:{in:ids}},{kind:'loginLimit',id:{in:usernames.map(digest)}},...ids.map(id=>({kind:'session',payload:{path:['userId'],equals:id}}))]}});
  if(actorId)await db.audit.deleteMany({where:{detail:{path:['actorId'],equals:actorId}}});
 }
});
