import {it,expect} from 'vitest';
import {asPrincipal} from '../lib/auth';
import {centerId,recordSpace,reportSpace,inCenter,inWorkspace,receiptId} from '../lib/workspace';
import {centerRegistry,emptyCenter} from '../lib/center-registry';
import {permitted} from '../lib/auth-policy';
import {testPrincipal} from './auth-fixture';
import {centerWeatherConfig} from '../lib/center-weather';
it('new centers never silently use the legacy weather grid',()=>{
 const env={KMA_SERVICE_KEY:'test',KMA_GRID_NX:'1',KMA_GRID_NY:'2',KMA_JANGGYE_GRID_NX:'3',KMA_JANGGYE_GRID_NY:'4'};
 expect(centerWeatherConfig('demo',env)).toMatchObject({nx:'1',ny:'2'});
 expect(centerWeatherConfig('janggye',env)).toMatchObject({nx:'3',ny:'4'});
 expect(centerWeatherConfig('cheoncheon',env)).toMatchObject({nx:undefined,ny:undefined});
});
it('session center wins over URL workspaces and background contexts, including concurrent requests',async()=>{
 const results=await Promise.all(centerRegistry.map(c=>asPrincipal({...testPrincipal,centerId:c.id},async()=>{await Promise.resolve();return inWorkspace('operations',()=>inCenter('demo',()=>({center:centerId(),space:recordSpace(),report:reportSpace(),receipt:receiptId('same')})))})));
 expect(results.map(r=>r.center)).toEqual(centerRegistry.map(c=>c.id));expect(new Set(results.map(r=>r.space)).size).toBe(4);expect(new Set(results.map(r=>r.receipt)).size).toBe(4);
 expect(results.find(r=>r.center==='demo')?.space).toBe('sandbox');expect(results.find(r=>r.center==='demo')?.report).toBe('reports');
 expect(()=>asPrincipal({...testPrincipal,role:'SUPER_ADMIN',centerId:null},recordSpace)).toThrow();
});
it('all four centers have empty starting ledgers and cannot access legacy demonstrations or other roles',()=>{
 for(const c of centerRegistry){const s=emptyCenter(c.id),p={...testPrincipal,centerId:c.id};expect(s.machines).toHaveLength(0);expect(s.staffCount).toBe(0);expect(permitted(p,'fields','GET',null)).toBe(true);expect(permitted({...p,role:'CENTER_STAFF'},'center-resources','POST',{})).toBe(false);if(c.id!=='demo')expect(permitted(p,'demo-data','POST',{})).toBe(false)}
 expect(new Set(centerRegistry.map(c=>c.prefix)).size).toBe(4);
});
