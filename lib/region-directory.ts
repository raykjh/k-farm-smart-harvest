export const regionLayers={province:{data:'LT_C_ADSIDO_INFO',code:'ctprvn_cd',name:'ctp_kor_nm',length:2,parentLength:0},district:{data:'LT_C_ADSIGG_INFO',code:'sig_cd',name:'sig_kor_nm',length:5,parentLength:2},township:{data:'LT_C_ADEMD_INFO',code:'emd_cd',name:'emd_kor_nm',length:8,parentLength:5}} as const;
export type RegionLevel=keyof typeof regionLayers;
export function regionQuery(level:string,parent:string,code:string){
 if(!Object.hasOwn(regionLayers,level))throw Error('지역 단계 확인 필요');
 const config=regionLayers[level as RegionLevel];
 if(code?!new RegExp(`^\\d{${config.length}}$`).test(code):config.parentLength?!new RegExp(`^\\d{${config.parentLength}}$`).test(parent):parent!=='')throw Error('지역 코드 형식 확인 필요');
 return config;
}
// Organization ownership, service jurisdiction and administrative geography are separate.
export type CenterTerritory={centerId:string;operatorId:string;regionCode:string;codeSystem:'VWORLD_LEGAL_AREA';level:RegionLevel;validFrom:string;validUntil:string|null;sourceVersion:string;status:'PROPOSED'|'CONFIRMED'};
export function regionOfParcel(pnu:string){if(!/^\d{19}$/.test(pnu))throw Error('PNU 형식 오류');return {province:pnu.slice(0,2),district:pnu.slice(0,5),township:pnu.slice(0,8),legalArea:pnu.slice(0,10)};}
