import {db} from '../lib/db';
import {refreshAllCenters} from '../lib/production-sweep';
// Persistent draft calculation only. No inference, notifications or automatic approval.
const once=process.argv.includes('--once');let running=false,stopping=false;
async function tick(){if(running||stopping)return;running=true;try{await refreshAllCenters()}finally{running=false}}
await tick();
if(once)await db.$disconnect();
else{const timer=setInterval(()=>void tick(),60000);for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{stopping=true;clearInterval(timer);await db.$disconnect();process.exit(0)})}
