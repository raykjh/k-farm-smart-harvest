import {afterEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {readProviderArtifact,providerArtifactPaths,ProviderArtifactError} from '../lib/provider-artifacts';
import {demoParcelsSchema,registeredDemo as build} from '../lib/registered-demo';
import {syntheticDemoParcels} from './registered-demo-fixture';
import {makeContract} from '../lib/annual-replanning';

const folders:string[]=[];
function temporary(){mkdirSync('.data',{recursive:true});const dir=mkdtempSync(resolve('.data/provider-artifacts-test-'));folders.push(dir);return dir;}
afterEach(()=>{for(const dir of folders.splice(0)){if(!resolve(dir).startsWith(resolve('.data/provider-artifacts-test-'))||lstatSync(dir).isSymbolicLink())throw Error('Unsafe test cleanup');rmSync(dir,{recursive:true});}});
it('does not silently invent missing data or fall through an invalid provided file',()=>{
 const dir=temporary();expect(readProviderArtifact('registeredParcels',{directory:dir,legacy:false})).toBeNull();
 writeFileSync(resolve(dir,providerArtifactPaths.registeredParcels.name),'{bad json');
 expect(()=>readProviderArtifact('registeredParcels',{directory:dir,legacy:false})).toThrow(ProviderArtifactError);
});
it('accepts an explicit file and leaves semantic validation to the scenario schema',()=>{
 const dir=temporary(),path=resolve(dir,providerArtifactPaths.registeredParcels.name);
 writeFileSync(path,JSON.stringify(syntheticDemoParcels));
 expect(demoParcelsSchema.parse(readProviderArtifact('registeredParcels',{directory:dir,legacy:false}))).toEqual(syntheticDemoParcels);
 expect(()=>build(syntheticDemoParcels.slice(1))).toThrow(ProviderArtifactError);
});
it('carries explicit operation windows, allowing scheduling without any provider file',()=>{
 const state=build(syntheticDemoParcels).state;
 expect(state.missions.every(m=>m.planningWindow?.basis==='DEMO_OPERATION_WINDOW')).toBe(true);
 const selected=state.missions.find(m=>m.scheduledDate==='2026-09-10'&&m.status==='PLANNED')!;
 const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',fetchedAt:'2026-09-10',points:[]};
 const result=makeContract(state,{ids:[selected.id],preferred:'2026-09-11'},weather as any,'2026-09-10');
 expect(result.contract.tasks.some(t=>t.id===selected.id)).toBe(true);
});
