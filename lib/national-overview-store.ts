import type {Prisma} from '@prisma/client';
import type {State} from './types';
import {recordSpace} from './workspace';
import {readWorkspaceRecords} from './workspace-record-reader';
import {buildNationalOverview,combineNationalOverviews,type NationalFilter} from './national-overview';

export async function readNationalOverview(tx:Prisma.TransactionClient,filter:NationalFilter,today:string){
 const centers=await tx.center.findMany({select:{id:true},orderBy:{id:'asc'}}),parts=[];
 for(const {id} of centers){
  const center=await tx.center.findUniqueOrThrow({where:{id}});
  const records=await readWorkspaceRecords(tx,recordSpace(id),['cultivation','cultivationPlan','continuousProduction','centerSettings','operatingLedger','taskExecutionAssessment','registrationOrigin'],true);
  parts.push(buildNationalOverview([{...center,state:center.state as unknown as State}],records,filter,today));
 }
 return combineNationalOverviews(parts,filter,today);
}
