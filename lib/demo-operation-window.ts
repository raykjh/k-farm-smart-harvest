import type {Mission} from './types';

// Legacy scenario tolerances, not official agronomic limits. New fixture inputs
// persist these windows with each mission so the engine needs no parcel snapshot.
export function demoOperationWindow(m:Mission,original:Pick<Mission,'scheduledDate'|'duration'>){
 if(!original.scheduledDate)return;
 let before=2,after=4;const label=m.label;
 if(/상담|정산/.test(label)){before=0;after=20;}
 else if(/수확|굴취/.test(label)){before=m.crop==='고추'?2:3;after=m.crop==='고추'?4:6;}
 else if(/모내기|파종|정식/.test(label)){before=3;after=5;}
 else if(/방제/.test(label)){before=1;after=3;}
 else if(/확인|예찰|관리/.test(label)){before=2;after=3;}
 const shift=(days:number)=>new Date(Date.parse(original.scheduledDate!+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 return {from:shift(-before),to:shift(after),duration:original.duration,windLimitMs:m.windLimitMs??(m.resourceId?12:10),rainSensitive:!!m.resourceId||!/상담|정산|자재/.test(label),basis:'DEMO_OPERATION_WINDOW'};
}
