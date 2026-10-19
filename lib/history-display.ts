/** Presentation only: preserve full identity and UTC timestamps in audit records. */
export function historyActor(value:unknown){return String(value??'').replace(/\s*\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]/gi,'').trim()||'—'}
export function historyDate(value:unknown){
 const text=String(value??''),date=new Date(text);if(!text||!Number.isFinite(date.getTime()))return text||'—';
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
