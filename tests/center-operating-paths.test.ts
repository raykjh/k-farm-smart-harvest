import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {inCenter,centerId} from '../lib/workspace';
import {readCenterWeatherConfig} from '../lib/center-settings-store';
import {refreshAllCenters} from '../lib/production-sweep';
import {centerRegistry} from '../lib/center-registry';
const mocks=vi.hoisted(()=>({find:vi.fn(),center:vi.fn(),refresh:vi.fn(),transaction:vi.fn()}));
vi.mock('../lib/db',()=>({db:{workRecord:{findUnique:mocks.find},center:{findUnique:mocks.center},$transaction:mocks.transaction}}));
vi.mock('../lib/production-service',()=>({refreshProduction:mocks.refresh}));
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();vi.restoreAllMocks()});
it('uses each saved center grid, not the legacy grid; unset centers stay unset',async()=>{
 vi.stubEnv('KMA_GRID_NX','1');vi.stubEnv('KMA_GRID_NY','2');
 mocks.find.mockImplementation(async({where})=>({payload:{location:where.workspace_kind_id.workspace==='center:janggye'?{nx:73,ny:76}:null}}));
 expect(await inCenter('janggye',()=>readCenterWeatherConfig())).toMatchObject({nx:'73',ny:'76'});
 expect(await inCenter('gyenam',()=>readCenterWeatherConfig())).toMatchObject({nx:undefined,ny:undefined});
 for(const path of ['lib/replanning-service.ts','app/api/annual-dispatch/route.ts','app/api/environment-plan/route.ts']){
  const text=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  expect(text).toContain('readShortForecast(await readCenterWeatherConfig())');expect(text).not.toContain('process.env.KMA_GRID_NX');
 }
});
it('both runners sweep all centers, isolate one failure, and retry it on the next sweep',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 mocks.center.mockResolvedValue({id:'exists'});mocks.transaction.mockImplementation(fn=>fn({}));
 const seen:string[]=[];mocks.refresh.mockImplementation(async()=>{seen.push(centerId());if(centerId()==='janggye')throw Error('isolated failure')});
 const outcomes=await refreshAllCenters();expect(seen).toEqual(centerRegistry.map(c=>c.id));
 expect(outcomes.find(r=>r.centerId==='janggye')?.status).toBe('FAILED');expect(outcomes.find(r=>r.centerId==='gyenam')?.status).toBe('REFRESHED');
 mocks.refresh.mockResolvedValue({});expect((await refreshAllCenters()).every(r=>r.status==='REFRESHED')).toBe(true);
 for(const path of ['lib/production-loop.ts','scripts/production-worker.ts'])expect(readFileSync(new URL('../'+path,import.meta.url),'utf8')).toContain('refreshAllCenters()');
});
