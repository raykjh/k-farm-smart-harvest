/** Bounded parallel reads. Preserve parcel order and never synthesize a boundary. */
export async function loadParcelBoundaries<T>(ids:string[],read:(id:string)=>Promise<T>,signal:AbortSignal,concurrency=4){
 const unique=[...new Set(ids)],results=new Map<string,T>(),failed:string[]=[];
 let index=0;
 const worker=async()=>{while(!signal.aborted){const id=unique[index++];if(!id)return;try{const value=await read(id);if(!signal.aborted)results.set(id,value)}catch{if(!signal.aborted)failed.push(id)}}};
 await Promise.all(Array.from({length:Math.min(unique.length,Math.max(1,Math.min(4,concurrency)))},worker));
 return {items:unique.filter(id=>results.has(id)).map(id=>({id,value:results.get(id)!})),failed};
}
