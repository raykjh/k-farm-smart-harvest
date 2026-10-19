import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {db} from '@/lib/db';
import {recordSpace} from '@/lib/workspace';
import {fieldInventory} from '@/lib/field-record';
import {readCropChangeOptions} from '@/lib/crop-change-options';

export const GET=withAuth('cultivations',async req=>{
 try{
  const pnu=req.nextUrl.searchParams.get('pnu');
  if(!pnu||!/^\d{19}$/.test(pnu))throw Error('농지를 선택해주세요.');
  const result=await db.$transaction(async tx=>{
   const row=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'fields',id:'current'}}});
   const field=fieldInventory.parse(row?.payload??[]).find(f=>f.pnu===pnu);if(!field)throw Error('등록 농지가 없습니다.');
   const result=await readCropChangeOptions(tx,field);
   return {...result,choices:result.choices.map(({context,...choice})=>choice)};
  });
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'작물 후보 확인 실패'},{status:409});}
});
