import {NextResponse,type NextRequest} from 'next/server';
import {authenticate} from './lib/auth';
import {applicationRedirect} from './lib/application-origin';
export async function proxy(req:NextRequest){
 if(req.nextUrl.pathname==='/login')return NextResponse.next();
 try{const user=await authenticate(req);if(!user)return NextResponse.redirect(applicationRedirect('/login',req));
 if(user.mustChangePassword&&req.nextUrl.pathname!=='/password')return NextResponse.redirect(applicationRedirect('/password',req));
 if(user.role==='SUPER_ADMIN'&&!['/workflow','/reservations','/accounts','/crop-standards','/references','/crop-info','/equipment-info','/capacity','/password'].includes(req.nextUrl.pathname))return NextResponse.redirect(applicationRedirect('/accounts',req));
 return NextResponse.next();}catch{return new NextResponse('인증 서비스를 확인하세요. / Authentication unavailable',{status:503})}
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.ico).*)']};
