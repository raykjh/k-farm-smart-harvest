import {db} from '../lib/db';
import {initialState} from '../lib/seed';
async function main(){ await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:initialState()},update:{}}); console.log('Demo center initialized (existing data preserved).'); await db.$disconnect(); }
main();
