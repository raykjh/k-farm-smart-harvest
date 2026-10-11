import {PrismaClient} from '@prisma/client';
const g=globalThis as unknown as {prisma?:PrismaClient};
export const db=g.prisma??new PrismaClient({datasourceUrl:process.env.DATABASE_URL??'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'});
if(process.env.NODE_ENV!=='production') g.prisma=db;
