// Server-side provider access. Never return or log the authenticated request URL.
import {normalizePrice,priceProducts,priceQuerySchema,uniquePrices,type PriceQuery,type PriceObservation} from './price-reference';
const endpoint='https://apis.data.go.kr/B552845/perDay/price';
export async function fetchAtPrices(input:PriceQuery,options:{key?:string;fetcher?:typeof fetch;today?:string}={}){
 const query=priceQuerySchema.parse(input),today=options.today??new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 if(query.to>today)throw Error('미래의 조사일은 수집할 수 없습니다.');
 let key=options.key??process.env.AT_PRICE_SERVICE_KEY;if(!key)throw Error('가격 API 인증이 설정되지 않았습니다.');
 try{key=decodeURIComponent(key)}catch{throw Error('가격 API 인증 형식을 확인하세요.')}
 const fetcher=options.fetcher??fetch,product=priceProducts[query.crop],rows:PriceObservation[]=[];let expected:number|null=null,calls=0;
 for(let page=1;page<=20;page++){
  const url=new URL(endpoint);url.search=new URLSearchParams({serviceKey:key,pageNo:String(page),numOfRows:'1000',returnType:'JSON','cond[exmn_ymd::GTE]':query.from.replaceAll('-',''),'cond[exmn_ymd::LTE]':query.to.replaceAll('-',''),'cond[ctgry_cd::EQ]':product.category,'cond[item_cd::EQ]':product.item}).toString();
  let body:any;
  try{const response=await fetcher(url,{signal:AbortSignal.timeout(20000),cache:'no-store',redirect:'error'});calls++;if(!response.ok)throw Error();const text=await response.text();if(text.length>5000000)throw Error();body=JSON.parse(text);}catch{throw Error('가격 제공기관 응답을 받지 못했습니다. 저장된 자료는 유지됩니다.');}
  const result=body?.response;if(!['0','00'].includes(String(result?.header?.resultCode)))throw Error('가격 제공기관이 수집을 승인하지 않았습니다. 인증과 조회 조건을 확인하세요.');
  const data=result?.body,total=Number(data?.totalCount);
  if(!Number.isInteger(total)||total<0||total>20000||expected!==null&&expected!==total)throw Error('가격 수집 범위가 너무 크거나 수집 중 자료가 바뀌었습니다. 기간을 줄여 다시 수집하세요.');
  expected=total;const item=data?.items?.item;const items=Array.isArray(item)?item:item&&typeof item==='object'?[item]:[];
  if(items.length>1000||!items.length&&rows.length<total)throw Error('가격 응답의 일부가 누락되었습니다.');
  for(const item of items){const row=normalizePrice(item,query.crop);if(row.date<query.from||row.date>query.to)throw Error('응답 조사일이 요청 기간을 벗어났습니다.');rows.push(row);}
  if(rows.length>=total){if(rows.length!==total)throw Error('가격 응답 건수가 일치하지 않습니다.');return {query,observations:uniquePrices(rows),providerCount:total,calls};}
 }
 throw Error('가격 수집 페이지 한도를 초과했습니다.');
}
