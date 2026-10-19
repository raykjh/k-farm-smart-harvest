import {centerRegistry} from './center-registry';
import {refreshSms} from './sms-store';
const root=globalThis as unknown as {kfarmSmsLoop?:{timer:ReturnType<typeof setInterval>;busy:boolean}};
/** Queue only. No provider credentials or external network calls. */
export function startSmsLoop(){
 if(root.kfarmSmsLoop)return;const loop={timer:undefined as unknown as ReturnType<typeof setInterval>,busy:false};root.kfarmSmsLoop=loop;
 async function tick(){if(loop.busy)return;loop.busy=true;try{for(const c of centerRegistry)try{await refreshSms(c.id)}catch{console.error('SMS queue refresh unavailable for center; will retry.')}}finally{loop.busy=false}}
 loop.timer=setInterval(()=>void tick(),60000);loop.timer.unref();const first=setTimeout(()=>void tick(),0);first.unref();
}
