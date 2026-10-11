import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {db} from '@/lib/db';
import {saveRegistration} from '@/lib/registration-service';
export const POST=withAuth('consultations',async req=>{
 try{const input=await req.json();const result=await db.$transaction(tx=>saveRegistration(tx,input,currentPrincipal()!.id),{timeout:20000});return NextResponse.json(result);}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'등록 실패'},{status:409});}
});
