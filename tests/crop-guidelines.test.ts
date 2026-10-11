import {it,expect} from 'vitest';
import {guidelineTasks} from '../lib/crop-guidelines';
it('derives pepper topdress from chosen regional planting anchor',()=>{const tasks=guidelineTasks('pepper',2026,{anchors:{pepper:{planting:'2026-05-10'}}});expect(tasks.find(t=>t.code==='fertilize')!.window).toMatchObject({from:'2026-06-04',to:'2026-06-09'});expect(tasks.find(t=>t.code==='harvest')!.kind).toBe('REPEAT')});
it('rice uses heading anchor and preserves missing dates',()=>{expect(guidelineTasks('rice',2026).every(t=>t.date===null)).toBe(true);expect(guidelineTasks('rice',2026,{anchors:{rice:{heading:'2026-08-20'}}}).find(t=>t.code==='drain')!.window).toMatchObject({from:'2026-07-11',to:'2026-07-21'})});
it('rejects invalid dates and years',()=>{expect(()=>guidelineTasks('potato',2026,{anchors:{potato:{planting:'2026-02-30'}}})).toThrow();expect(()=>guidelineTasks('potato',2026,{anchors:{potato:{planting:'2027-03-20'}}})).toThrow()});
