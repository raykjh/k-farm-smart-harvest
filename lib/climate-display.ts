import type {NormalDay} from './climate-anchor';
export function monthlyNormals(values:NormalDay[]){
 return Array.from({length:12},(_,i)=>{
  const month=String(i+1).padStart(2,'0');
  const days=values.filter(v=>v.monthDay.startsWith(month+'-')&&Number.isFinite(v.meanC));
  return {month:i+1,days:days.length,meanC:days.length?days.reduce((sum,v)=>sum+v.meanC,0)/days.length:null};
 });
}
