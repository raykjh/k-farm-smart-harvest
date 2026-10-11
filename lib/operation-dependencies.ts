import type {CropCode} from './crop-guidelines';
const common:Record<string,string[]>={seed:[],soil:[],plant:['seed','soil'],nursery:['seed'],establish:['plant'],emerge:['plant'],hill:['plant'],drain:['plant'],fertilize:['plant'],heading:['plant'],stake:['plant'],care:['plant'],treat:['plant'],'fertilize-repeat':['plant'],harvest:['plant'],finish:['harvest'],cleanup:['harvest','finish']};
export function prerequisiteInstances(crop:CropCode,task:{code:string;occurrence:number},all:{code:string;occurrence:number;instanceCode:string}[]){
 const stages=task.code==='plant'&&crop==='rice'?['nursery','soil']:common[task.code]??[];
 let selected=all.filter(p=>stages.includes(p.code));
 const keys=task.code==='finish'?['harvest'+(task.occurrence>1?':'+task.occurrence:'')]:selected.map(p=>p.instanceCode);
 if(task.occurrence>1)keys.push(task.code+(task.occurrence>2?':'+(task.occurrence-1):''));
 return [...new Set(keys)];
}
