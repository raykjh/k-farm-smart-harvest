import {PrismaClient} from '@prisma/client';
import {db} from './db';

// Acceptance business data may be disposable; the paid-call ledger never is.
// Server-only configuration, not a request parameter or a new per-test allowance.
const g=globalThis as unknown as {aiLedger?:{url:string;client:PrismaClient}};
export function aiBudgetDb(){
 const url=process.env.AI_BUDGET_DATABASE_URL;
 if(!url||url===process.env.DATABASE_URL)return db;
 if(g.aiLedger&&g.aiLedger.url!==url)throw Error('AI ledger cannot change during a process');
 if(!g.aiLedger)g.aiLedger={url,client:new PrismaClient({datasourceUrl:url})};
 return g.aiLedger.client;
}
