import {it,expect,afterAll,afterEach,vi} from 'vitest';
import {db} from '../lib/db';
import {beforeEach} from 'vitest';
import {reserveBudget,VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD,SUBMISSION_BASELINE_MICRO_USD,SUBMISSION_ADDITIONAL_MICRO_USD,MAX_REQUEST_RESERVATION_MICRO_USD} from '../lib/ai-budget';
afterAll(async()=>{await db.$disconnect();});
afterEach(()=>vi.unstubAllEnvs());
// Prisma Date is UTC-truncated while PostgreSQL CURRENT_DATE follows the DB
// time zone. Seed the same calendar day as reserveBudget, including KST 00-09h.
let budgetDay:Date;
beforeEach(async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw new Error('Test database required');
 const [row]=await db.$queryRaw<{today:Date}[]>`SELECT CURRENT_DATE AS today`;
 budgetDay=row.today;
 await db.aiBudget.deleteMany();
});
it('removes the daily cap but atomically preserves the lifetime cap across concurrent requests',async()=>{
 vi.stubEnv('KFARM_AI_SPENDING_PHASE','judging');
 // Seed historical use only in the isolated DB, keeping the validation cap intact.
 await db.aiBudget.create({data:{id:'nebius-primary',total:4_000_000,daily:980_000,day:budgetDay}});
 const results=await Promise.allSettled(Array.from({length:8},()=>reserveBudget(5000)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(8);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).total).toBe(4_040_000);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).daily).toBe(1_020_000);
 await db.aiBudget.update({where:{id:'nebius-primary'},data:{total:19_990_000,daily:1_000_000,day:new Date('2020-01-01')}});
 const lifetime=await Promise.allSettled(Array.from({length:4},()=>reserveBudget(5000)));
 expect(lifetime.filter(r=>r.status==='fulfilled')).toHaveLength(2);
 await expect(reserveBudget(5000)).rejects.toThrow('exhausted');
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).total).toBe(20_000_000);
});
it('stops concurrent development calls at $10 and preserves the same history for judging',async()=>{
 vi.stubEnv('KFARM_AI_SPENDING_PHASE','development');
 await db.aiBudget.create({data:{id:'nebius-primary',total:9_990_000,daily:0,day:budgetDay}});
 await db.aiBudget.create({data:{id:VALIDATION_BUDGET_ID,total:8_990_000,daily:0,day:budgetDay}});
 const results=await Promise.allSettled(Array.from({length:4},()=>reserveBudget(5000)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).total).toBe(10_000_000);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}})).total).toBe(9_000_000);
 vi.stubEnv('KFARM_AI_SPENDING_PHASE','judging');await reserveBudget(5000);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).total).toBe(10_005_000);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}})).total).toBe(9_005_000);
});
it('honors small reservations without deleting historical counters',async()=>{
 await db.aiBudget.create({data:{id:'nebius-primary',total:1_000_000,daily:990_000,day:budgetDay}});
 const results=await Promise.allSettled(Array.from({length:4},()=>reserveBudget(5000)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(4);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).total).toBe(1_020_000);
});
it('preserves the approved baseline and bounds a single request independently of daily usage',async()=>{
 expect(VALIDATION_MICRO_USD-SUBMISSION_BASELINE_MICRO_USD).toBe(15_000_000);
 expect(SUBMISSION_ADDITIONAL_MICRO_USD).toBe(15_000_000);
 await db.aiBudget.create({data:{id:VALIDATION_BUDGET_ID,total:SUBMISSION_BASELINE_MICRO_USD,daily:SUBMISSION_BASELINE_MICRO_USD,day:budgetDay}});
 await reserveBudget(5000);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}})).total).toBe(SUBMISSION_BASELINE_MICRO_USD+5000);
 await expect(reserveBudget(MAX_REQUEST_RESERVATION_MICRO_USD+1)).rejects.toThrow('Invalid');
});
it('serializes the validation ceiling and rolls back the primary reservation on rejection',async()=>{
 await db.aiBudget.create({data:{id:'nebius-primary',total:10_000,daily:10_000,day:budgetDay}});
 await db.aiBudget.create({data:{id:VALIDATION_BUDGET_ID,total:VALIDATION_MICRO_USD-5000,daily:0,day:budgetDay}});
 const results=await Promise.allSettled(Array.from({length:4},()=>reserveBudget(5000)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:'nebius-primary'}})).total).toBe(15_000);
 expect((await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}})).total).toBe(VALIDATION_MICRO_USD);
});
