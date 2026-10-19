import {refreshAllAttendance} from './labor-attendance-store';
const loops=globalThis as unknown as {kfarmLaborAttendanceLoop?:{timer:ReturnType<typeof setInterval>;busy:boolean}};
export function startLaborAttendanceLoop(){
 if(loops.kfarmLaborAttendanceLoop)return;
 const loop={timer:undefined as unknown as ReturnType<typeof setInterval>,busy:false};loops.kfarmLaborAttendanceLoop=loop;
 async function tick(){if(loop.busy)return;loop.busy=true;try{await refreshAllAttendance()}catch{console.error('Labor attendance refresh failed; retrying next minute.')}finally{loop.busy=false}}
 loop.timer=setInterval(()=>void tick(),60000);loop.timer.unref();const first=setTimeout(()=>void tick(),0);first.unref();
}
