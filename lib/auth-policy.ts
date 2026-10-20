import type {Principal} from './auth';
import {knownCenter} from './center-registry';
export const hasCenterOperationsRole=(p:Principal|null|undefined):p is Principal&{centerId:string}=>!!p?.enabled&&typeof p.centerId==='string'&&!!p.centerId&&['CENTER_ADMIN','CENTER_STAFF'].includes(p.role);
export const isCenterOperator=(p:Principal|null|undefined):p is Principal&{centerId:string}=>hasCenterOperationsRole(p)&&knownCenter(p.centerId);
// The route reads this saved view under the production lock, never from request input.
export function canConfirmProduction(p:Principal|null|undefined,view:unknown){
 if(!p?.enabled||!knownCenter(p.centerId)||p.role==='SUPER_ADMIN')return false;
 // Both center roles perform the same operational review. Commit-time source,
 // model-error, consent and resource checks still run in approveProduction.
 const saved=view as {aiReviewError?:unknown;items?:{status?:string;proposal?:unknown}[]}|null;
 return isCenterOperator(p)&&!!saved&&!saved.aiReviewError&&!!saved.items?.some(i=>i.status==='REVIEW'&&i.proposal);
}
const centerBusinessPaths=new Set(['labor-policy','operating-ledger','integrated-planning','production-coordination','labor-sharing','labor-capacity','equipment-missions','capacity-studies','center-settings','continuous-production','center-resources','shared-reservations','task-schedule','replanning','equipment','task-cancellations','fields','consultations','annual-plan','environment-plan','environment-windows','cultivations','annual-dispatch','delegated-planning','operations','execution-records','labor','labor-operations','work-history','work-reports']);
const reads=new Set(['annual-plan','climate-anchors','annual-dispatch','consultations','cultivations','demo','delegated-planning','environment-plan','environment-windows','fields','demo-data','incidents','operations','labor','map-tile','execution-records','labor-operations','regional-crop-standards','parcels','work-history','work-reports','workspace','weather','weather/forecast','crop-reference','crop-catalog']);
export function permitted(p:Principal,path:string,method:string,body:any){
 if(path==='prepared-inputs')return p.enabled&&p.role==='SUPER_ADMIN'&&!p.judgeAccount&&['GET','POST'].includes(method);
 if(['national-overview','map-tile'].includes(path))return method==='GET'&&(p.role==='SUPER_ADMIN'||knownCenter(p.centerId));
 if(['price-reference','economic-reference'].includes(path))return (p.role==='SUPER_ADMIN'||knownCenter(p.centerId))&&(method==='GET'||method==='POST'&&p.role==='SUPER_ADMIN'&&!p.judgeAccount);
 if(p.judgeAccount&&(['accounts','demo','demo-data','workflow-experience'].includes(path)||method!=='GET'&&['workspace','center-settings'].includes(path)||['reset','seed','clear','restore'].includes(body?.action)))return false;
 if(path==='replanning'&&method==='POST'&&!['preview','compare','approve','automatic','recoverAutomatic','saveManualAlternative'].includes(body?.action))return false;
 if(path==='task-schedule'&&method==='POST'&&!['preview','save'].includes(body?.action))return false;
 if(p.role==='CENTER_STAFF'&&centerBusinessPaths.has(path))return permitted({...p,role:'CENTER_ADMIN'},path,method,body);
 if(['labor-policy','operating-ledger'].includes(path))return knownCenter(p.centerId)&&p.role!=='SUPER_ADMIN'&&(method==='GET'||method==='POST'&&p.role==='CENTER_ADMIN');
 if(path==='integrated-planning')return (p.role==='SUPER_ADMIN'||knownCenter(p.centerId))&&(method==='GET'||method==='POST'&&(body?.action==='plan'&&['SUPER_ADMIN','CENTER_ADMIN'].includes(p.role)||['stage','apply'].includes(body?.action)&&p.role==='CENTER_ADMIN'&&knownCenter(p.centerId)));
 if(path==='equipment-schedule')return isCenterOperator(p)&&['GET','POST'].includes(method);
 if(path==='messages')return knownCenter(p.centerId)&&p.role!=='SUPER_ADMIN'&&(method==='GET'||method==='POST'&&['prepare','simulate','review','resend'].includes(body?.action));
 if(path==='replanning'&&method==='GET')return knownCenter(p.centerId)&&p.role!=='SUPER_ADMIN';
 if(path==='labor-recovery')return method==='GET'&&knownCenter(p.centerId);
 if(path==='production-coordination')return (p.role==='SUPER_ADMIN'||knownCenter(p.centerId))&&(method==='GET'||method==='POST'&&(p.role==='SUPER_ADMIN'||p.role==='CENTER_ADMIN'));
 if(path==='labor-sharing')return knownCenter(p.centerId)&&(method==='GET'||method==='POST'&&p.role==='CENTER_ADMIN');
 if(path==='labor-capacity')return knownCenter(p.centerId)&&(method==='GET'||method==='POST'&&p.role==='CENTER_ADMIN');
 if(path==='equipment-missions')return knownCenter(p.centerId)&&(method==='GET'||method==='POST'&&p.role==='CENTER_ADMIN');
 if(path==='equipment-information')return method==='GET'&&(p.role==='SUPER_ADMIN'||knownCenter(p.centerId));
 if(path==='capacity-studies')return (p.role==='SUPER_ADMIN'||knownCenter(p.centerId))&&(method==='GET'||method==='POST'&&(['analyze','distribute'].includes(body?.action)||p.role==='SUPER_ADMIN'||p.role==='CENTER_ADMIN'));
 if(path==='center-settings')return knownCenter(p.centerId)&&p.role!=='SUPER_ADMIN'&&(method==='GET'||method==='POST'&&p.role==='CENTER_ADMIN');
 if(path==='regions')return method==='GET'&&(p.role==='SUPER_ADMIN'||knownCenter(p.centerId));
 if(path==='operations'&&method==='POST'&&p.centerId!=='demo'&&body?.action!=='deliver')return false;
 if(path==='continuous-production')return knownCenter(p.centerId)&&p.role!=='SUPER_ADMIN'&&(method==='GET'||method==='POST'&&(['refresh','approve'].includes(body?.action)||p.role==='CENTER_ADMIN'));
 if(['workflow-experience','demo','demo-data'].includes(path)&&p.centerId!=='demo')return false;
 if(path==='workflow-experience')return method==='GET'||method==='POST';
 if(path==='center-resources')return p.role==='SUPER_ADMIN'?method==='GET':knownCenter(p.centerId)&&(method==='GET'||method==='POST'&&(p.role==='CENTER_ADMIN'||body?.action==='ackNotice'));
 if(path==='shared-reservations')return method==='GET'&&(p.role==='SUPER_ADMIN'||!!p.centerId)||method==='POST'&&(p.role==='SUPER_ADMIN'||p.role==='CENTER_ADMIN'&&!!p.centerId);
 if(!reads.has(path)&&!['task-schedule','replanning','equipment','task-cancellations'].includes(path))return false;
 if(p.role==='SUPER_ADMIN')return ['regional-crop-standards','crop-catalog','crop-reference','environment-windows','climate-anchors'].includes(path);
 if(!knownCenter(p.centerId))return false;
 if(method==='GET')return reads.has(path);
 if(method!=='POST')return false;
 if(p.role==='CENTER_ADMIN')return path!=='regional-crop-standards'; // shared reference writes are global administration
 if(['consultations','fields','annual-plan','environment-plan','environment-windows','cultivations','annual-dispatch'].includes(path))return true;
 // Rescheduling is a center operator's job, including the atomic save and
 // recovery used by the one-click UI. Scope is still taken from the session.
 if(p.role==='CENTER_STAFF'&&path==='replanning')return ['preview','compare','approve','automatic','recoverAutomatic','saveManualAlternative'].includes(body?.action);
 if(p.role==='CENTER_STAFF'&&path==='task-schedule')return ['preview','save'].includes(body?.action);
 if(path==='delegated-planning')return body?.action==='preview';
 if(path==='labor-operations')return ['person','saveWorker','employees','saveAttendance','response','distance','sync'].includes(body?.action);
 return false;
}
