import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,passwordHash,digest} from '../lib/auth';
test('login, create a center account, actor autofill and logout enforce server permissions',async({page,request})=>{
 const id=randomUUID(),username='e2e-'+id,manager='mgr-'+id,password='Long-private-fixture-'+randomUUID();const ids:string[]=[id];
 await db.workRecord.create({data:{...authKey('user',id),payload:{id,username,name:'E2E admin',passwordHash:await passwordHash(password),role:'SUPER_ADMIN',centerId:null,enabled:true}}});
 try{
  expect((await request.get('/api/fields')).status()).toBe(401);
  await page.goto('/');await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('아이디',{exact:true}).fill(username);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);
  await page.getByLabel('아이디',{exact:true}).fill(manager);await page.getByLabel('이름',{exact:true}).fill('E2E manager');await page.getByLabel('비밀번호 (12자 이상)',{exact:true}).fill(password);await page.getByRole('combobox',{name:'권한',exact:true}).selectOption('CENTER_ADMIN');await page.getByLabel('담당 센터',{exact:true}).selectOption('demo');await page.getByRole('button',{name:'계정 생성'}).click();await expect(page.getByText(manager,{exact:true})).toBeVisible();
  expect(await page.evaluate(async()=> (await fetch('/api/fields')).status)).toBe(403);
  await page.getByRole('button',{name:'로그아웃'}).click();await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('아이디',{exact:true}).fill(manager);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).toHaveURL(/\/password$/);
  await page.getByLabel('현재 비밀번호',{exact:true}).fill(password);await page.getByLabel('새 비밀번호 (12자 이상)',{exact:true}).fill(password+'changed');await page.getByLabel('새 비밀번호 확인',{exact:true}).fill(password+'changed');await page.getByRole('button',{name:'비밀번호 변경',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await page.goto('/reports');await expect(page.getByLabel('확인 담당자')).toHaveValue(/E2E manager/);await expect(page.getByLabel('확인 담당자')).toHaveAttribute('readonly','');
  await page.getByRole('button',{name:'로그아웃'}).click();await expect(page).toHaveURL(/\/login$/);expect(await page.evaluate(async()=> (await fetch('/api/work-reports')).status)).toBe(401);
 }finally{
  const users=await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}});const created=users.find(u=>(u.payload as any).username===manager);if(created)ids.push(created.id);
  const sessions=await db.workRecord.findMany({where:{workspace:'auth',kind:'session'}});const sessionIds=sessions.filter(s=>ids.includes((s.payload as any).userId)).map(s=>s.id);
  await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id:{in:ids}},{kind:'session',id:{in:sessionIds}},{kind:'loginLimit',id:{in:[digest(username),digest(manager)]}}]}});
  await db.audit.deleteMany({where:{OR:ids.map(id=>({detail:{path:['actorId'],equals:id}}))}});
 }
});
