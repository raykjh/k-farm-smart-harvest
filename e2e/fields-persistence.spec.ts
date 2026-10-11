import {test,expect} from './authenticated-test';
test('database roundtrip and workspace isolation without changing field payload',async({request,page})=>{
 const op=await (await request.get('/api/fields?workspace=operations')).json();
 const before=await (await request.get('/api/fields?workspace=sandbox')).json();
 const data={workspace:'sandbox',version:before.version,payload:before.payload};
 const r=await request.post('/api/fields',{data});expect(r.status()).toBe(200);
 const saved=await r.json();expect(saved.payload).toEqual(before.payload);
 expect((await request.post('/api/fields',{data})).status()).toBe(409);
 expect(await (await request.get('/api/fields?workspace=operations')).json()).toEqual(saved);
 await page.goto('/');await page.getByRole('button',{name:'농지',exact:true}).click();
 await expect(page.getByRole('button',{name:'농지 저장',exact:true})).toBeEnabled();
 await expect(page.getByText(`v${saved.version}`,{exact:true})).toBeVisible();
});
