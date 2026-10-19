import type {Prisma} from '@prisma/client';
import {recordSpace} from './workspace';
import {defaultLaborPolicy,type LaborPolicy} from './labor-policy';

export async function readLaborPolicy(tx:Prisma.TransactionClient,centerId:string,year:number){
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(centerId),kind:'laborPolicy',id:String(year)}}});
 return {version:row?.version??0,policy:row?row.payload as unknown as LaborPolicy:defaultLaborPolicy(year)};
}
export async function laborPoliciesForDates(tx:Prisma.TransactionClient,centerId:string,dates:string[]){
 const entries=await Promise.all([...new Set(dates.map(d=>d.slice(0,4)))].map(async year=>[year,await readLaborPolicy(tx,centerId,Number(year))] as const));
 return Object.fromEntries(entries);
}
