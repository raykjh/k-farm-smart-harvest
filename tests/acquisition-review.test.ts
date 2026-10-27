import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {recordAcquisitionReviews} from '../lib/acquisition-review';
import type {JointEvaluation} from '../lib/integrated-plan';
import {recordSpace} from '../lib/workspace';

it('stores an internal review once, merges overlapping demand, and never calls a purchase or marks resources secured',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated database required');
 await expect(db.$transaction(async tx=>{
  const workspace=recordSpace('demo'),kind='equipmentAcquisitionReview';
  await tx.workRecord.deleteMany({where:{workspace,kind}});
  const evaluation={id:'fixture-evaluation',requests:[{centerId:'demo',resource:'PD',route:'ADJACENT_THEN_ACQUIRE'}],equipment:[{centerId:'demo',code:'PD',from:'2027-06-01',to:'2027-06-20',minimumUnits:3,ownedUnits:2,additionalLowerBound:1,workHours:180}],views:[{centerId:'demo',view:{items:[{proposal:{cultivation:{start:'2027-02-01'}}}]}}]} as unknown as JointEvaluation;
  const input={draftId:'fixture-draft',fingerprint:'fixture-source',actor:'isolated-test',source:'RULES' as const};
  const first=await recordAcquisitionReviews(tx,evaluation,input),repeat=await recordAcquisitionReviews(tx,evaluation,input);
  expect(repeat).toEqual(first);expect(await tx.workRecord.count({where:{workspace,kind}})).toBe(1);
  const firstRow=await tx.workRecord.findFirstOrThrow({where:{workspace,kind}});expect(firstRow.version).toBe(1);
  evaluation.id='changed';evaluation.equipment[0].from='2027-06-10';evaluation.equipment[0].to='2027-07-01';
  expect(await recordAcquisitionReviews(tx,evaluation,{...input,draftId:'second'})).toEqual(first);
  const row=await tx.workRecord.findFirstOrThrow({where:{workspace,kind}});
  expect(row.payload).toMatchObject({from:'2027-06-01',to:'2027-07-01',additionalLowerBound:1,purchaseAuthorized:false,availabilityConfirmed:false,costAssessment:'UNKNOWN',subsidyAssessment:'UNKNOWN',recurrence:'SINGLE_FORECAST_YEAR',draftIds:['fixture-draft','second']});
  expect(await tx.workRecord.count({where:{workspace,kind}})).toBe(1);
  throw Error('ROLLBACK_ACQUISITION');
 })).rejects.toThrow('ROLLBACK_ACQUISITION');
});
it('does not create equipment purchase requests for production targets or variety criteria',async()=>{
 await expect(db.$transaction(async tx=>{
  const before=await tx.workRecord.count({where:{kind:'equipmentAcquisitionReview'}});
  const e={id:'criteria',equipment:[{centerId:'demo',code:'PD'}],requests:[{centerId:'demo',resource:'PRODUCTION_TARGET',route:'PRODUCTION_REVIEW'}],views:[]} as unknown as JointEvaluation;
  expect(await recordAcquisitionReviews(tx,e,{draftId:'criteria',fingerprint:'x',actor:'isolated-test',source:'RULES'})).toEqual([]);
  expect(await tx.workRecord.count({where:{kind:'equipmentAcquisitionReview'}})).toBe(before);
  throw Error('ROLLBACK_ACQUISITION');
 })).rejects.toThrow('ROLLBACK_ACQUISITION');
});
