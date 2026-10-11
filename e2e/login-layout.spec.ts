import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/api/auth',async r=>{if(r.request().method()==='GET')await r.fulfill({json:{user:null}});else await r.fulfill({status:400,json:{error:'아이디 또는 비밀번호를 확인하세요.'}})})});
test('simple login form, keyboard submission, remember option and responsive layout',async({page})=>{
 const calls:any[]=[];await page.route('**/api/auth',async r=>{if(r.request().method()==='GET')return r.fulfill({json:{user:null}});calls.push(r.request().postDataJSON());await r.fulfill({status:400,json:{error:'아이디 또는 비밀번호를 확인하세요.'}})});
 await page.goto('/login');await expect(page.getByRole('heading',{name:'로그인',exact:true})).toBeVisible();
 await expect(page.getByLabel('아이디',{exact:true})).toBeVisible();await expect(page.getByLabel('비밀번호',{exact:true})).toHaveAttribute('type','password');
 await expect(page.getByLabel('로그인 유지',{exact:true})).not.toBeChecked();await expect(page.getByRole('button',{name:'회원가입',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'비밀번호 찾기',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/login-desktop.png',fullPage:true});
 await page.getByLabel('아이디',{exact:true}).fill('layout-only');await page.getByLabel('비밀번호',{exact:true}).fill('Not-a-real-password');await page.getByLabel('로그인 유지',{exact:true}).check();await page.getByLabel('비밀번호',{exact:true}).press('Enter');
 await expect(page.locator('.login-form').getByRole('alert')).toContainText('아이디 또는 비밀번호');expect(calls[0]).toMatchObject({action:'login',username:'layout-only',remember:true});
 expect(await page.evaluate(()=>Object.keys(localStorage).some(k=>/password|token/i.test(k)))).toBe(false);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/login-mobile.png',fullPage:true});
 await page.getByRole('combobox',{name:'언어 / Language'}).selectOption('en');await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await expect(page.getByLabel('Keep me signed in')).toBeVisible();
});
test('membership request opens a separate form, and recovery uses existing administrator code',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:'회원가입',exact:true}).click();const dialog=page.getByRole('dialog');
 for(const label of ['아이디','이름','생년월일','소속','연락처','비밀번호','비밀번호 확인'])await expect(dialog.getByLabel(label,{exact:true})).toBeVisible();
 await expect(dialog).toContainText('총괄관리자');await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'비밀번호 찾기',exact:true}).click();await expect(dialog).toContainText('총괄관리자에게 비밀번호 재설정');
 await dialog.locator('summary').click();await expect(dialog.getByLabel('일회성 복구 코드')).toBeVisible();
});
test('signup submits pending application and never starts a session',async({page})=>{
 const calls:any[]=[];await page.route('**/api/auth',async r=>{if(r.request().method()==='GET')return r.fulfill({json:{user:null}});calls.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,status:'PENDING'}})});
 await page.goto('/login');await page.getByRole('button',{name:'회원가입',exact:true}).click();const dialog=page.getByRole('dialog');
 for(const [label,value] of [['아이디','ui-signup'],['이름','홍가명'],['생년월일','1980-01-01'],['소속','계북면 농업지원센터'],['연락처','000-0000-0000'],['비밀번호','Signup-check-1234'],['비밀번호 확인','Signup-check-1234']])await dialog.getByLabel(label,{exact:true}).fill(value);
 await dialog.getByRole('button',{name:'가입 신청',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('총괄관리자 승인 후');expect(calls).toHaveLength(1);expect(calls[0].action).toBe('signup');await expect(page).toHaveURL(/\/login$/);
});
test('bootstrap setup stays separate and cannot be exposed by ordinary login',async({page})=>{
 await page.goto('/login#setup='+'a'.repeat(64));await expect(page.getByRole('heading',{name:'최초 총괄 계정 설정'})).toBeVisible();await expect(page.getByLabel('이름',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'회원가입',exact:true})).toHaveCount(0);await expect(page).toHaveURL(/\/login$/);
});
