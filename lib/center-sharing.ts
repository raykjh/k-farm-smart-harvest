import type {Machine} from './types';

/** Myeon is the service boundary, not an equipment ownership boundary. */
export type ServiceCenter = {id:string; name:string; regionCode:string; regionType:'MYEON'; staffIds:string[]; neighborCenterIds:string[]};
export type EquipmentLoan = {
 id:string; machineId:string; ownerCenterId:string; borrowerCenterId:string;
 usableFrom:string; usableUntil:string; status:'REQUESTED'|'CONFIRMED'|'CANCELLED'|'RETURNED';
 transportConfirmed:boolean; operatorConfirmed:boolean;
 returnedOn?:string; returnedAt?:string; returnedBy?:string;
};
export type CenterSharing = {centerId:string; neighborCenterIds:string[]; loans:EquipmentLoan[];offers?:import('./equipment-sharing-offers').SharingOffer[];blocks?:import('./equipment-sharing-offers').ResourceBlock[];lendingDays?:{ownerCenterId:string;date:string;capacity:number}[]};
const day=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateLoan(loan:EquipmentLoan, existing:EquipmentLoan[]){
 if(!loan.id||!loan.machineId||!loan.ownerCenterId||!loan.borrowerCenterId||loan.ownerCenterId===loan.borrowerCenterId)throw Error('장비 소속과 대여 센터를 확인하세요.');
 if(!day(loan.usableFrom)||!day(loan.usableUntil)||loan.usableFrom>loan.usableUntil)throw Error('운송·복귀를 반영한 사용 가능 기간이 필요합니다.');
 if(loan.status==='CONFIRMED'){
  if(!loan.transportConfirmed||!loan.operatorConfirmed)throw Error('운송과 운영담당자 확보 확인이 필요합니다.');
  if(existing.some(x=>x.id!==loan.id&&x.machineId===loan.machineId&&x.status==='CONFIRMED'&&x.usableFrom<=loan.usableUntil&&loan.usableFrom<=x.usableUntil))throw Error('해당 장비의 대여 기간이 중복됩니다.');
 }
 return loan;
}
export function machineAvailableToCenter(machine:Machine,date:string,sharing?:CenterSharing){
 if(!sharing)return !machine.ownerCenterId||machine.ownerCenterId==='demo'; // Legacy local center; foreign equipment still requires a loan.
 if(!machine.ownerCenterId)return false; // No inferred ownership in shared mode.
 const loans=sharing.loans.filter(l=>l.machineId===machine.id&&l.ownerCenterId===machine.ownerCenterId&&l.status==='CONFIRMED'&&l.usableFrom<=date&&date<=l.usableUntil);
 if(machine.ownerCenterId===sharing.centerId)return loans.length===0;
 if(!sharing.neighborCenterIds.includes(machine.ownerCenterId)||loans.length!==1)return false;
 const loan=loans[0];return loan.borrowerCenterId===sharing.centerId&&loan.transportConfirmed&&loan.operatorConfirmed;
}
