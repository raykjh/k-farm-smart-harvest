import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {suggestAnchors,thermalPolicy} from '@/lib/climate-anchor';
import {readCenterSettings} from '@/lib/center-settings-store';
import {centerId} from '@/lib/workspace';
import type {CenterSettings} from '@/lib/center-settings';
async function handleGET(req:NextRequest){
 const year=Number(req.nextUrl.searchParams.get('year'));if(!Number.isInteger(year)||year<2000||year>2200)return NextResponse.json({error:'Invalid year'},{status:400});
 try{const saved=await readCenterSettings(),settings=saved?.payload as CenterSettings|undefined;
 const selection=settings?.climate,explicitClimate=settings&&Object.hasOwn(settings,'climate');
 const datasetId=selection?.datasetId??(!explicitClimate&&centerId()==='demo'?'ASOS:248:1991-2020:spring':null);
 if(!datasetId)return NextResponse.json({error:'센터 운영 설정에서 평년자료를 선택하세요.'},{status:409});
 const row=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'shared',kind:'climateNormals',id:datasetId}}});
 if(selection&&row?.version!==selection.datasetVersion)return NextResponse.json({error:'선택한 평년자료가 변경되었습니다. 센터 설정에서 다시 확인하세요.'},{status:409});
 const data=row?.payload as any;if(!data)return NextResponse.json({error:'평년자료 미등록'},{status:503});
 return NextResponse.json({anchors:suggestAnchors(data.values,year),station:data.stationName,period:data.period,sourceUrl:data.sourceUrl,policy:thermalPolicy,status:'PROVISIONAL_DEMO_HEURISTIC',warning:'선택 관측소 참고값·7일 연속 평균기온 기준의 후보. 품종·지온·늦서리·현장 조건 검토 전이며 확정 적기가 아닙니다.'});
 }catch{return NextResponse.json({error:'평년자료 조회 실패'},{status:503})}
}

export const GET=withAuth('climate-anchors',handleGET);
