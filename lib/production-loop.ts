import {refreshAllCenters} from './production-sweep';
const globalLoop=globalThis as unknown as {kfarmProductionLoop?:{timer:ReturnType<typeof setInterval>;busy:boolean}};
/** Long-lived Node server only. A change fingerprint prevents repeated planning. */
export function startProductionLoop(){
 if(globalLoop.kfarmProductionLoop)return;
 const loop={timer:undefined as unknown as ReturnType<typeof setInterval>,busy:false};
 globalLoop.kfarmProductionLoop=loop;
 async function tick(){if(loop.busy)return;loop.busy=true;try{await refreshAllCenters()}catch{console.error('Production draft refresh failed; saved work is unchanged.')}finally{loop.busy=false}}
 loop.timer=setInterval(()=>void tick(),60000);loop.timer.unref();
 const first=setTimeout(()=>void tick(),0);first.unref();
}
