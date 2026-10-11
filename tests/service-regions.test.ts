import {it,expect} from 'vitest';
import {serviceRegions,serviceRegionScope} from '../lib/service-regions';
it('keeps the four township service desks distinct without migrating existing records or granting loans',()=>{
 expect(serviceRegions.map(r=>r.township)).toEqual(['장계면','천천면','계북면','계남면']);
 expect(new Set(serviceRegions.map(r=>r.id)).size).toBe(4);
 expect(serviceRegions.find(r=>r.legacyCenterId==='demo')?.township).toBe('계북면');
 expect(serviceRegions.filter(r=>r.legacyCenterId!==null)).toHaveLength(1);
 expect(serviceRegionScope.status).toBe('PROPOSED');
 expect(serviceRegionScope.requiresConfirmedLoan).toBe(true);
});
