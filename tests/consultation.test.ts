import {it,expect} from 'vitest';
import {consultationSchema} from '../lib/consultation';
const base={farmer:{name:'Test',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},fields:[],consent:false,step:0};
it('accepts drafts and rejects invalid birth dates',()=>{expect(consultationSchema.safeParse(base).success).toBe(true);expect(consultationSchema.safeParse({...base,farmer:{...base.farmer,birth:'1960-02-31'}}).success).toBe(false);expect(consultationSchema.safeParse({...base,farmer:{...base.farmer,birth:'2999-01-01'}}).success).toBe(false)});
it('rejects unexpected personal identifier fields',()=>expect(consultationSchema.safeParse({...base,farmer:{...base.farmer,residentId:'unwanted'}}).success).toBe(false));
it('rejects fabricated rights approval and duplicate parcels',()=>{
 const f={id:'11111111-1111-4111-8111-111111111111',pnu:'5274036023106160004',address:'Test',area:'3000',crop:'rice',mode:'joint',tenure:'family',ownerName:'',ownerPhone:'',evidence:'family',end:'',callAt:'',operator:'',callResult:'confirmed',scope:'',verified:'pending'};
 expect(consultationSchema.safeParse({...base,fields:[f]}).success).toBe(true);
 expect(consultationSchema.safeParse({...base,fields:[{...f,verified:'approved'}]}).success).toBe(false);
 expect(consultationSchema.safeParse({...base,fields:[f,{...f,id:'22222222-2222-4222-8222-222222222222'}]}).success).toBe(false);
});
