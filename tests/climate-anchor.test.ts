import {expect,it} from 'vitest';
import {suggestAnchors} from '../lib/climate-anchor';
it('requires seven consecutive regional days',()=>{const rows=Array.from({length:7},(_,i)=>({monthDay:'05-0'+(i+1),meanC:16}));expect(suggestAnchors(rows,2026).pepper?.planting).toBe('2026-05-01');expect(suggestAnchors(rows.slice(1),2026).pepper).toBeUndefined();expect(suggestAnchors(rows.map(r=>({...r,meanC:12})),2026).pepper).toBeUndefined()});
