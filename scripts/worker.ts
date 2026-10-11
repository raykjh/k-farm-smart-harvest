import {deliver} from '../lib/service';
const once=process.argv.includes('--once');
async function tick(){try{const r=await deliver();if(r.attempted)console.log(r);}catch{console.error('Outbox retry pending; database unavailable.');}}
await tick();if(once)process.exit(0);setInterval(tick,3000);
