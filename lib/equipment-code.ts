import type {State} from './types';
import {centerRegistry} from './center-registry';

// K-Farm's internal center prefix, independent of official administrative codes.
const centerPrefixes:Readonly<Record<string,string>>=Object.fromEntries(centerRegistry.map(c=>[c.id,c.prefix]));
const legacyCodes:Readonly<Record<string,string>>={D1:'JB23DR01',D2:'JB23DR02',P1:'JB23SD01',H1:'JB23HV01'};

export function equipmentCode(id:string){return legacyCodes[id]??id}

export function nextEquipmentCode(state:State,kind:string,centerId=state.centerSharing?.centerId??'demo'){
 const prefix=centerPrefixes[centerId];
 if(!prefix)throw Error('센터 장비코드가 설정되지 않았습니다. 센터 설정을 확인하세요.');
 if(!/^[A-Z]{2}$/.test(kind))throw Error('장비 종류 코드를 확인하세요.');
 const pattern=new RegExp(`^${prefix}${kind}(\\d+)$`);
 // Keep identifiers referenced by work/loans reserved even if no longer in the ledger.
 const ids=[...state.machines.map(m=>m.id),...state.missions.flatMap(m=>m.resourceId?[m.resourceId]:[]),...(state.centerSharing?.loans.map(l=>l.machineId)??[])];
 const max=ids.reduce((n,id)=>Math.max(n,Number(equipmentCode(id).match(pattern)?.[1]??0)),0);
 if(!Number.isSafeInteger(max+1))throw Error('장비 일련번호 범위를 확인하세요.');
 return `${prefix}${kind}${String(max+1).padStart(2,'0')}`;
}
