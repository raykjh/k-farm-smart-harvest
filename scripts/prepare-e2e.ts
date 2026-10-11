import {db} from '../lib/db';
import {initialState} from '../lib/seed';
if(process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_test')throw new Error('Only isolated kfarm_test may be reset');
await db.$transaction([db.outbox.deleteMany(),db.receipt.deleteMany(),db.audit.deleteMany(),db.center.deleteMany(),db.center.create({data:{id:'demo',state:initialState()}})]);
await db.$disconnect();
