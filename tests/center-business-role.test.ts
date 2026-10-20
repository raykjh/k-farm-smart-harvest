import {it,expect} from 'vitest';
import {permitted,canConfirmProduction} from '../lib/auth-policy';
import type {Principal} from '../lib/auth';
const staff:Principal={id:'operator',username:'operator',name:'Operator',role:'CENTER_STAFF',centerId:'demo',enabled:true};
it('gives both center roles the same operational actions while preserving global and account boundaries',()=>{
 for(const path of ['center-settings','production-coordination','operating-ledger','labor-policy','equipment-missions','labor-capacity','labor-sharing','center-resources','shared-reservations','execution-records'])expect(permitted(staff,path,'POST',{})).toBe(permitted({...staff,role:'CENTER_ADMIN'},path,'POST',{}));
 for(const path of ['accounts','regional-crop-standards','price-reference','economic-reference'])expect(permitted(staff,path,'POST',{})).toBe(false);
 expect(permitted({...staff,centerId:'unregistered'},'center-settings','POST',{})).toBe(false);
 expect(permitted({...staff,judgeAccount:true},'center-settings','POST',{})).toBe(false);
});
it('requires a saved reviewable plan and retains model-error, center and disabled-account guards',()=>{
 const view={items:[{status:'REVIEW',proposal:{}}]};for(const role of ['CENTER_ADMIN','CENTER_STAFF'] as const){expect(canConfirmProduction({...staff,role},view)).toBe(true);for(const invalid of [null,{}, {items:[]},{...view,aiReviewError:{message:'failed'}}])expect(canConfirmProduction({...staff,role},invalid)).toBe(false);}expect(canConfirmProduction({...staff,enabled:false},view)).toBe(false);expect(canConfirmProduction({...staff,centerId:'other'},view)).toBe(false);
});
