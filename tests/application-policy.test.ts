import {it,expect} from 'vitest';
import {assertOwnerApplication} from '../lib/application-policy';
import type {Consultation} from '../lib/consultation';
it('requires ownership for new policy enrollment without rewriting legacy records',()=>{
 const c={application:{policy:'OWNER_SERVICE_V1'},fields:[{pnu:'test',tenure:'lease'}]} as unknown as Consultation;
 const before=JSON.stringify(c);expect(()=>assertOwnerApplication(c,'test')).toThrow();
 c.fields[0].tenure='owned';expect(()=>assertOwnerApplication(c,'test')).not.toThrow();
 expect(()=>assertOwnerApplication({...c,application:undefined},'test')).not.toThrow();
 expect(before).toContain('lease');
});
