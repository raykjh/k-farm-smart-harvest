import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {catalogVersion,cropCatalog} from '@/lib/crop-catalog';
async function handleGET(){return NextResponse.json({version:catalogVersion,profiles:cropCatalog,scope:'SOURCE_DIRECTORY_NOT_OPERATIONAL_APPROVAL'},{headers:{'Cache-Control':'public, max-age=3600'}});}

export const GET=withAuth('crop-catalog',handleGET);
