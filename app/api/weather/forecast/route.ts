import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {readUltraForecast,readShortForecast,readDailyForecast} from '@/lib/kma-forecast';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(){
 const config=await readCenterWeatherConfig();
 const [ultra,short,daily]=await Promise.all([readUltraForecast(config),readShortForecast(config),readDailyForecast(config)]);
 return NextResponse.json({ultra,short,daily},{headers:{'Cache-Control':'no-store'}});
}

export const GET=withAuth('weather/forecast',handleGET);
