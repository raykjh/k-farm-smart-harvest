import {db} from '../lib/db';
import {migrateReservations} from '../lib/reservation-operations';
import type {Principal} from '../lib/auth';
const apply=process.argv.includes('--apply');
try{const actor={id:'local-owner-authorized-migration',role:'SUPER_ADMIN',centerId:null} as Principal;const result=await db.$transaction(tx=>migrateReservations(tx,'demo',actor,apply),{isolationLevel:'Serializable',timeout:20000});console.log(JSON.stringify(result));}catch(e){console.error(e instanceof Error?e.message:'Migration failed');process.exitCode=1}finally{await db.$disconnect()}
