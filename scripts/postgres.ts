import EmbeddedPostgres from 'embedded-postgres';
import {existsSync} from 'node:fs';
const pg=new EmbeddedPostgres({databaseDir:'.data/postgres',user:'kfarm',password:'kfarm_local_demo',port:55432,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C']});
async function main(){
 if(!existsSync('.data/postgres/PG_VERSION')) await pg.initialise();
 await pg.start();
 const c=pg.getPgClient(); await c.connect();
 const r=await c.query("SELECT 1 FROM pg_database WHERE datname='kfarm'");
 if(!r.rowCount) await c.query('CREATE DATABASE kfarm');
 await c.end();
 console.log('K-Farm PostgreSQL ready on localhost:55432');
 for(const sig of ['SIGINT','SIGTERM'] as const) process.on(sig,async()=>{await pg.stop();process.exit(0)});
}
main().catch(e=>{console.error(e);process.exit(1)});
