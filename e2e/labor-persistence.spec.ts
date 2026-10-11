import {test,expect} from './authenticated-test';
test('database roundtrip preserves data and rejects stale version',async({request,page})=>{
 const opBefore=await (await request.get('/api/labor?workspace=operations')).json();
 const before=await (await request.get('/api/labor?workspace=sandbox')).json();
 const data={workspace:'sandbox',version:before.version,payload:before.payload};
 const r=await request.post('/api/labor',{data});expect(r.status()).toBe(200);
 const saved=await r.json();expect(saved.payload).toEqual(before.payload);expect(saved.version).toBe(before.version+1);
 expect((await request.post('/api/labor',{data})).status()).toBe(409);
 await page.goto('/labor?workspace=sandbox');
 await expect(page.getByText(`v${saved.version}`,{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText(`v${saved.version}`,{exact:true})).toBeVisible();
 const opAfter=await (await request.get('/api/labor?workspace=operations')).json();expect(opAfter).toEqual(saved);
 expect((await request.post('/api/labor',{headers:{origin:'https://invalid.example'},data})).status()).toBe(403);
});
