import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {cropReferences} from '@/lib/crop-reference';
export const GET=withAuth('crop-reference',async()=>NextResponse.json({version:'public-baseline-v1',references:cropReferences,coverage:'HISTORICAL_NATIONAL_REFERENCE_NOT_FIELD_FORECAST',supplyPenaltyEnabled:false}));
