import {it,expect,vi,afterEach} from 'vitest';
import {spawnSync} from 'node:child_process';
import {acceptanceDatabaseUrl,fourCenterDatabase,fourCenterDatabaseUrl,localTestDatabaseBase} from '../scripts/disposable-test-db';
afterEach(()=>vi.unstubAllEnvs());

it('allows only fixed loopback test names and explicitly selected four-center run suffixes',()=>{
 vi.stubEnv('KFARM_FOUR_CENTER_DATABASE','kfarm_centers_e2e_source_20261011');
 expect(fourCenterDatabase()).toBe('kfarm_centers_e2e_source_20261011');
 expect(fourCenterDatabaseUrl()).toBe(localTestDatabaseBase+'kfarm_centers_e2e_source_20261011');
 expect(acceptanceDatabaseUrl('kfarm_test')).toBe(localTestDatabaseBase+'kfarm_test');
 expect(acceptanceDatabaseUrl('kfarm_centers_e2e')).toBe(localTestDatabaseBase+'kfarm_centers_e2e');
 expect(acceptanceDatabaseUrl('kfarm_centers_e2e_other')).toBe(localTestDatabaseBase+'kfarm_centers_e2e_other');
});

it.each(['kfarm','postgres','kfarm_test','kfarm_centers_e2e_','kfarm_centers_e2e_'+ 'x'.repeat(31),'kfarm_centers_e2e_prod;DROP DATABASE kfarm','kfarm_centers_e2e_run?host=remote','kfarm_centers_e2e_run/../kfarm','kfarm_centers_e2e_run\n','postgresql://remote/kfarm_centers_e2e'])('refuses a non-four-center destination: %s',name=>{
 expect(()=>fourCenterDatabase(name)).toThrow();
 if(name!=='kfarm_test')expect(()=>acceptanceDatabaseUrl(name)).toThrow();
});

it('rejects absent acceptance destinations and invalid environment selection',()=>{
 for(const value of [undefined,null,0,{},''])expect(()=>acceptanceDatabaseUrl(value)).toThrow();
 vi.stubEnv('KFARM_FOUR_CENTER_DATABASE','kfarm');expect(()=>fourCenterDatabaseUrl()).toThrow();
});

it('all launchers reject an operating database before opening it or starting a server',()=>{
 for(const [file,flag] of [['scripts/setup-centers-e2e.ts','--database=kfarm'],['scripts/acceptance-web.ts','--database=kfarm'],['scripts/acceptance-https.ts','--db=kfarm']] as const){
  const r=spawnSync(process.execPath,['--import','tsx',file,flag,'--run=invalid-db-test'],{encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,DATABASE_URL:'not-a-database-url',KFARM_FOUR_CENTER_DATABASE:'kfarm',NEBIUS_API_KEY:''}});
  expect(r.status,file).not.toBe(0);expect(r.stderr,file).toContain('test database required');
  expect(r.stdout,file).not.toMatch(/schema ready|Next\.js|Local HTTPS/);
 }
});
