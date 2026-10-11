import {db} from '../lib/db';
try{
 const values:{monthDay:string;meanC:number}[]=[];
 for(let month=3;month<=6;month++){
 for(let day=1;day<=new Date(2025,month,0).getDate();day++){
 const r=await fetch('https://data.kma.go.kr/normals/anal8Ajax.do',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({DEPTH1:'KOR_1991_30_v2',DEPTH2:'DD',schStnId:'248',schElmId:'AVG_TA',d_msel:String(month),d_dsel:String(day),startYear:'2021'}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error();const d=await r.json(),v=d.dataList?.[0],monthDay=String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
 if(d.code!=='00'||v?.stnId!==248||v.col1!=='AVG_TA'||!Number.isFinite(v.val1)||v.ymd!==monthDay.replace('-','월 ')+'일')throw Error();
 values.push({monthDay,meanC:v.val1});
 }console.log('month imported',month);
 }
 const payload={stationId:'248',stationName:'장수',period:'1991-2020',sourceUrl:'https://data.kma.go.kr/normals/anal8.do',retrievedAt:new Date().toISOString(),coverage:'03-01/06-30',values};
 await db.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('shared','climateNormals','ASOS:248:1991-2020:spring',1,${JSON.stringify(payload)}::jsonb) ON CONFLICT (workspace,kind,id) DO UPDATE SET payload=EXCLUDED.payload,version="WorkRecord".version+1,"updatedAt"=CURRENT_TIMESTAMP`;
 console.log(JSON.stringify({saved:values.length}));
}catch{console.log('NORMALS_IMPORT_FAILED');process.exitCode=1}finally{await db.$disconnect()}
