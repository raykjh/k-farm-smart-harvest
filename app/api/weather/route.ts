import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {readKma} from '@/lib/kma';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(){
 const result=await readKma(await readCenterWeatherConfig());
 return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
}

export const GET=withAuth('weather',handleGET);
