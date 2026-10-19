import {test,expect} from './authenticated-test';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {recordSpace} from '../lib/workspace';

const menu=['메인','일정표','장비현황','농지','인력관리','실적·통계','데모','설정','작물정보','장비정보'];
test('saved consultation retains its data, steps, sidebar and printable document',async({page},info)=>{
 const key={workspace:recordSpace('demo'),kind:'consultation',id:randomUUID()};
 const payload={farmer:{name:'홍검증',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},fields:[],consent:false,step:0};
 const row=await db.workRecord.create({data:{...key,payload,version:1}});
 const calls=await db.aiCall.count(),writes:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/')&&r.method()==='POST')writes.push(r.url())});
 try{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/register?consultation='+key.id);
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('홍검증');
  const nav=page.getByRole('navigation',{name:'주 메뉴'});
  for(const name of menu)await expect(nav.getByRole('link',{name,exact:true})).toBeVisible();
  await expect(nav.locator('[aria-current=page]')).toHaveText('농지');
  await expect(page.locator('.stepper .badge')).toHaveCount(4);
  await expect(page.getByText('센터 담당자용 · 농부 1명과 여러 농지를 함께 상담합니다.')).toHaveCount(0);
  await expect(page.getByText(/개발 중에는 가명·테스트 연락처/)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'임시 저장',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('consultation-sidebar.png')});
  await page.emulateMedia({media:'print'});await expect(page.locator('.paper-print')).toBeVisible();await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.emulateMedia({media:'screen'});await page.getByLabel('언어 / Language').selectOption('en');
  await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Fields',exact:true})).toBeVisible();
  await expect(page.getByText('For center staff · one farmer and multiple fields.')).toHaveCount(0);
  expect(writes).toEqual([]);expect(await db.aiCall.count()).toBe(calls);
  expect(await db.workRecord.findUnique({where:{workspace_kind_id:key}})).toEqual(row);
 }finally{await db.workRecord.deleteMany({where:key})}
});

test('standalone operating pages retain every navigation entry and capacity controls',async({page},info)=>{
 for(const path of ['/capacity','/references','/reservations','/crop-standards']){
  await page.goto(path);const nav=page.getByRole('navigation',{name:'주 메뉴'});
  for(const name of menu)await expect(nav.getByRole('link',{name,exact:true})).toBeVisible();
 }
 await page.goto('/capacity');
 await expect(page.getByText('기준 입력 → 수요 산정 → 자원 고정 → 대안 비교')).toHaveCount(0);
 await expect(page.getByText(/소유자 수의 33%를 참여 가정/)).toHaveCount(0);
 await expect(page.getByText('작물별 작업 기준',{exact:false}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'빈 입력 양식',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('capacity-sidebar.png')});
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByText(/Participation is 33% of distinct owners/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Empty input template',exact:true})).toBeVisible();
});
