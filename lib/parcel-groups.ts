export type ParcelCrop=import('./crop-registry').SupportedCropCode|'';
export type GroupParcel={pnu:string;address:string;crop:ParcelCrop;group:string;geometry:any;area?:number|null;mode?:'joint'|'full';consultationId?:string};
export function addParcel(items:GroupParcel[],item:GroupParcel){
 if(items.some(p=>p.pnu===item.pnu))throw new Error('DUPLICATE_PNU');
 return [...items,item];
}
export function groupParcels(items:GroupParcel[],ids:string[],group:string){
 const selected=items.filter(p=>ids.includes(p.pnu));
 if(selected.length<2||selected.length!==new Set(ids).size||!group.trim())throw new Error('INVALID_GROUP');
 if(!selected[0].crop||selected.some(p=>p.crop!==selected[0].crop))throw new Error('SAME_CROP_REQUIRED');
 return items.map(p=>ids.includes(p.pnu)?{...p,group}:p);
}
