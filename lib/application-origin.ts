// Server-only deployment setting. Never infer trust from forwarded headers.
const localOrigins=['http://127.0.0.1:3100','http://localhost:3100'];

export function applicationOrigins():string[]{
 const configured=process.env.KFARM_APP_ORIGIN?.trim();
 if(!configured)return localOrigins;
 try{
  const url=new URL(configured);
  // A single canonical HTTPS origin, not a URL with credentials, path or query.
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.hostname||url.hostname.includes('*')||configured.replace(/\/$/,'')!==url.origin)return [];
  return [url.origin];
 }catch{return []}
}

export function validApplicationOrigin(req:Request){
 const origin=req.headers.get('origin'),host=req.headers.get('host');
 return applicationOrigins().some(allowed=>origin===allowed&&host===new URL(allowed).host);
}

export function validApplicationRequest(req:Request){
 if(!['GET','HEAD'].includes(req.method))return validApplicationOrigin(req);
 // Same-origin reads and top-level navigations normally omit Origin. Host is
 // still mandatory; a supplied Origin must match that same configured pair.
 const origin=req.headers.get('origin'),host=req.headers.get('host');
 return applicationOrigins().some(allowed=>host===new URL(allowed).host&&(origin===null||origin===allowed));
}

export function secureSessionCookie(req:Request){
 // TLS may terminate at the reverse proxy. The explicitly configured origin,
 // not an attacker-supplied X-Forwarded-Proto, determines the cookie policy.
 return applicationOrigins().some(origin=>origin.startsWith('https:'))||new URL(req.url).protocol==='https:';
}

export function setupApplicationOrigin(){
 const origin=applicationOrigins()[0];
 if(!origin)throw Error('KFARM_APP_ORIGIN must be a single canonical HTTPS origin');
 return origin;
}

export function applicationRedirect(path:string,req:Request){
 return new URL(path,process.env.KFARM_APP_ORIGIN?.trim()?setupApplicationOrigin():req.url);
}
