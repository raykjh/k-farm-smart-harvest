import {it,expect} from 'vitest';
import {jointPublicView} from '../lib/integrated-plan-service';

it('requires a current source fingerprint and never rewrites stored historical evidence',()=>{
 const draft={input:{requestId:'test',audience:'demo'},fingerprint:'original',status:'READY',source:'NEBIUS'};
 const before=JSON.stringify(draft);
 expect(jointPublicView(draft).freshness).toBe('UNVERIFIED');
 expect(jointPublicView(draft,'changed').freshness).toBe('STALE');
 expect(jointPublicView(draft,'original').freshness).toBe('CURRENT');
 expect(JSON.stringify(draft)).toBe(before);
});
