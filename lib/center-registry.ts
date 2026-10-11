import {serviceRegions} from './service-regions';
import type {State} from './types';

// Stable internal identifiers, not official administrative or cooperative codes.
export const centerRegistry=serviceRegions.map(r=>({
 id:r.legacyCenterId??r.id,regionId:r.id,township:r.township,office:r.office,
 name:`${r.township} 농업지원센터`,
 prefix:({gyebuk:'JB23',janggye:'JSJG',cheoncheon:'JSCC',gyenam:'JSGN'} as const)[r.id],
}));
export const knownCenter=(id:unknown):id is string=>typeof id==='string'&&centerRegistry.some(c=>c.id===id);
export function centerDefinition(id:string){const c=centerRegistry.find(c=>c.id===id);if(!c)throw Error('등록되지 않은 센터입니다.');return c;}
export function emptyCenter(id:string):State{
 const c=centerDefinition(id);
 return {name:c.name,fields:[],machines:[],missions:[],events:[],revisions:[],planVersion:0,staffCount:0,transportCount:0,ruleVersion:'UNCONFIGURED',registered:false,planned:false,
 centerSharing:{centerId:id,neighborCenterIds:[],loans:[]}};
}
