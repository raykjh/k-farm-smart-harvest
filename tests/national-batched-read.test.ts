import {it,expect} from 'vitest';
import {readNationalOverview} from '../lib/national-overview-store';
import {buildNationalOverview,type NationalFilter} from '../lib/national-overview';
import {nationalScaleFixture} from './national-scale-fixture';

it('preserves complete cross-center totals, filters, privacy and page boundaries',async()=>{
 const f=nationalScaleFixture(3000,4),records=f.records.map(r=>({...r,updatedAt:new Date('2026-10-27T00:00:00Z'),version:1}));
 let pageCount=0,maxPage=0;
 const tx:any={center:{findMany:async()=>f.centers.map(c=>({id:c.id})),findUniqueOrThrow:async({where}:any)=>f.centers.find(c=>c.id===where.id)},workRecord:{findMany:async(q:any)=>{
  expect(typeof q.where.workspace).toBe('string');expect(q.take).toBeLessThanOrEqual(200);
  const matched=records.filter(r=>r.workspace===q.where.workspace&&q.where.kind.in.includes(r.kind)).sort((a,b)=>a.id.localeCompare(b.id)||a.kind.localeCompare(b.kind));
  const cursor=q.cursor?.workspace_kind_id,start=cursor?matched.findIndex(r=>r.id===cursor.id&&r.kind===cursor.kind)+1:0;
  const page=matched.slice(start,start+q.take);pageCount++;maxPage=Math.max(maxPage,page.length);return page;
 }}};
 const filters:NationalFilter[]=[{year:2027},{year:2027,crop:'pepper'},{year:2027,center:f.centers[1].id},{year:2027,quarter:2},{year:2026}];
 const originalQueryOrder=[...records].sort((a,b)=>a.workspace.localeCompare(b.workspace)||a.id.localeCompare(b.id)||a.kind.localeCompare(b.kind));
 for(const filter of filters){const result=await readNationalOverview(tx,filter,'2027-06-15');expect(result).toEqual(buildNationalOverview(f.centers,originalQueryOrder,filter,'2027-06-15'));expect(JSON.stringify(result)).not.toContain('LOAD_PRIVATE');}
 expect(pageCount).toBeGreaterThan(20);expect(maxPage).toBe(200);
});

it('retains the empty national response',async()=>{
 const tx:any={center:{findMany:async()=>[]}};
 expect(await readNationalOverview(tx,{year:2027},'2027-01-01')).toEqual(buildNationalOverview([],[],{year:2027},'2027-01-01'));
});
