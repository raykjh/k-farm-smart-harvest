import {z} from 'zod';

export const HALF_DAY_MINUTES=240;
export const minimumWages:Record<number,{hourly:number;source:string}>={
 2026:{hourly:10320,source:'https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144&pageUnit=10'},
};
export const laborPolicyInput=z.object({year:z.number().int().min(2000).max(2200),hourlyWon:z.number().int().min(1).max(1000000),minimumHourlyWon:z.number().int().min(1).max(1000000),source:z.string().url().max(1000),reserveCount:z.number().int().min(0).max(100)}).strict().superRefine((p,ctx)=>{
 const official=minimumWages[p.year];
 if(official&&p.minimumHourlyWon!==official.hourly)ctx.addIssue({code:'custom',message:'확인된 연도별 최저시급과 다릅니다.'});
 if(p.hourlyWon<p.minimumHourlyWon)ctx.addIssue({code:'custom',message:'공통 시급은 해당 연도 최저시급 이상이어야 합니다.'});
 if(!/^https:\/\//.test(p.source))ctx.addIssue({code:'custom',message:'최저임금 근거는 HTTPS 주소로 입력하세요.'});
});
export type LaborPolicy=z.infer<typeof laborPolicyInput>;
export type PayBasis={year:number;hourlyWon:number;halfDayWon:number;policyVersion:number;source:string};
export function defaultLaborPolicy(year:number):LaborPolicy|null{
 const wage=minimumWages[year];
 return wage?{year,hourlyWon:wage.hourly,minimumHourlyWon:wage.hourly,source:wage.source,reserveCount:3}:null;
}
export const halfDayUnits=(minutes:number)=>Math.max(1,Math.ceil(minutes/HALF_DAY_MINUTES));
export function payBasis(policy:LaborPolicy|null,version=0):PayBasis|undefined{
 return policy?{year:policy.year,hourlyWon:policy.hourlyWon,halfDayWon:policy.hourlyWon*4,policyVersion:version,source:policy.source}:undefined;
}
export function payLabel(basis:PayBasis|undefined){return basis?`반나절(4시간) 기본액 ${basis.halfDayWon.toLocaleString('ko-KR')}원`:'해당 연도 공통 보수 기준 미설정';}
export function laborEarnings(basis:PayBasis|undefined,minutes:number,exceptionUnits?:number){
 return basis?Math.round(basis.halfDayWon*(exceptionUnits??halfDayUnits(minutes))):null;
}
