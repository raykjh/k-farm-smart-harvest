import type {Consultation} from './consultation';
// Drafts and historical records remain readable. This rule concerns new enrollment.
export function assertOwnerApplication(c:Consultation,pnu:string){
 if(c.application?.policy!=='OWNER_SERVICE_V1')return;
 const field=c.fields.find(f=>f.pnu===pnu);
 if(!field||field.tenure!=='owned')throw Error('신규 신청 대상은 본인 소유 농지입니다.');
 // Ownership selection is a declaration, never rights approval.
}
