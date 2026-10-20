import {NextResponse,type NextRequest} from 'next/server';
import {authenticate} from './lib/auth';
import {applicationRedirect,validApplicationRequest} from './lib/application-origin';
export async function proxy(req:NextRequest){
 if(!validApplicationRequest(req))return new NextResponse('출처 거부 / Origin rejected',{status:403});
 if(req.nextUrl.pathname==='/login'){const response=NextResponse.next();response.headers.set('Cache-Control','private, no-store');return response;}
 try{const user=await authenticate(req);if(!user)return NextResponse.redirect(applicationRedirect('/login',req));
 if(user.judgeAccount&&['/accounts','/password','/settings','/workflow'].includes(req.nextUrl.pathname))return NextResponse.redirect(applicationRedirect('/',req));
 if(user.mustChangePassword&&req.nextUrl.pathname!=='/password')return NextResponse.redirect(applicationRedirect('/password',req));
 if(user.role==='SUPER_ADMIN'&&!['/workflow','/reservations','/accounts','/crop-standards','/references','/crop-info','/equipment-info','/capacity','/password','/national','/price-info','/cost-info','/supply-info','/prepared-inputs'].includes(req.nextUrl.pathname))return NextResponse.redirect(applicationRedirect('/accounts',req));
 if(req.nextUrl.pathname==='/prepared-inputs'&&(user.role!=='SUPER_ADMIN'||user.judgeAccount))return NextResponse.redirect(applicationRedirect('/',req));
 return NextResponse.next();}catch{return new NextResponse('인증 서비스를 확인하세요. / Authentication unavailable',{status:503})}
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.ico).*)']};
