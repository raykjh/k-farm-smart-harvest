/** Executable input data, not certified agronomic instructions.
 * Numeric calendars, speeds and crews below are replaceable DEMO assumptions.
 * Source links substantiate crop coverage / equipment classes, not these numbers.
 * No restricted Nongsaro calendar text is reproduced. */
export const WORKLOAD_CATALOG_VERSION = 'crop30-workload-2026-10-03-v1';
export const workloadSources = [
 {id:'income',name:'농촌진흥청 농산물소득조사 조사품목',url:'https://nongsaro.go.kr/portal/ps/psz/psza/contentMainStat.ps?menuId=PS65575',scope:'CROP_COVERAGE'},
 {id:'calendar',name:'농촌진흥청 농작업일정 목록',url:'https://www.nongsaro.go.kr/portal/ps/psb/psbl/workScheduleLst.ps?menuId=PS00087',scope:'DIRECTORY_ONLY_KOGL_TYPE_2'},
 {id:'statistics',name:'2025 재배면적·생산량 조사 결과',url:'https://mods.go.kr/board.es?act=view&bid=228&list_no=442570&mid=a10301080100',scope:'CROP_COVERAGE_NOT_LOCAL_SHARE'},
 {id:'pesticide',name:'농촌진흥청 농약 품목별 사용기준',url:'https://psis.rda.go.kr/psis/saf/sus/safeUseStdrLst.ps',scope:'TREATMENT_REQUIRES_PRODUCT_REVIEW'},
 {id:'daedong',name:'대동 콤바인·이앙기 제품군',url:'https://ko.daedong.co.kr/product/combine',scope:'EQUIPMENT_CLASS_NOT_THROUGHPUT'},
 {id:'dji',name:'DJI AGRAS T50 제원',url:'https://ag.dji.com/t50/specs',scope:'EQUIPMENT_CLASS_NOT_APPLICATION_APPROVAL'},
] as const;

export const workloadEquipment = [
 {id:'TR',name:'트랙터·경운 작업기',en:'Tractor / tillage implement',source:'daedong'},
 {id:'RP',name:'벼 이앙기',en:'Rice transplanter',source:'daedong'},
 {id:'PS',name:'감자 파종기',en:'Potato planter',source:'calendar'},
 {id:'SE',name:'밭작물 파종기·해당 종자용 장치',en:'Seeder with crop-specific attachment',source:'calendar'},
 {id:'CB',name:'벼 콤바인',en:'Rice combine',source:'daedong'},
 {id:'GC',name:'곡물 콤바인·해당 작물용 헤더',en:'Grain combine with crop-specific header',source:'calendar'},
 {id:'PD',name:'감자 굴취기',en:'Potato digger',source:'calendar'},
 {id:'RD',name:'뿌리작물 굴취기·해당 작물용 작업기',en:'Root crop digger with suitable implement',source:'calendar'},
 {id:'DR',name:'농업용 드론·운영자',en:'Agricultural drone with operator',source:'dji'},
 {id:'GS',name:'지상 방제기·운영자',en:'Ground sprayer with operator',source:'calendar'},
] as const;
export type WorkloadCapability = typeof workloadEquipment[number]['id'];
export type MonthWindow = {from:string;to:string;yearOffset?:number};
export type WorkloadMethod = {
 id:string;capability:WorkloadCapability|null;
 mode:'MACHINE_WITH_OPERATOR'|'AUTOMATED_WITH_OPERATOR'|'MANUAL';
 operators:number;workers:number;transport:number;
 /** Elapsed crew time, NOT person-minutes; multiply by headcount for labor. */
 minutesPer1000m2:number;setupMinutes:number;availability:'CURRENT'|'FUTURE_ONLY';
};
export type WorkloadOperation = {
 code:string;name:string;windows:MonthWindow[];predecessors:string[];
 kind:'REQUIRED'|'INSPECTION'|'CONDITIONAL';condition:string|null;
 weather:'GROUND'|'DRONE'|'OUTDOOR_MANUAL';methods:WorkloadMethod[];
};
export type WorkloadCrop = {
 id:string;name:string;en:string;category:'PADDY'|'UPLAND'|'VEGETABLE'|'ORCHARD';
 practice:string;lifecycle:'SEASONAL'|'EXISTING_BEARING_ORCHARD';
 evidence:'SOURCE_REFERENCED_DEMO_PARAMETERS';regionalSuitability:'REVIEW_REQUIRED';
 serviceReview:'REVIEW_REQUIRED';sourceIds:string[];operations:WorkloadOperation[];
};
const w=(from:string,to:string,yearOffset=0):MonthWindow=>({from,to,yearOffset});
const manual=(minutes=180,workers=2):WorkloadMethod=>({id:'manual',capability:null,mode:'MANUAL',operators:0,workers,transport:0,minutesPer1000m2:minutes,setupMinutes:15,availability:'CURRENT'});
const machine=(capability:WorkloadCapability,minutes:number,workers=0):WorkloadMethod=>({id:capability,capability,mode:capability==='DR'?'AUTOMATED_WITH_OPERATOR':'MACHINE_WITH_OPERATOR',operators:1,workers,transport:1,minutesPer1000m2:minutes,setupMinutes:30,availability:'CURRENT'});
const op=(code:string,name:string,windows:MonthWindow[],methods:WorkloadMethod[],predecessors:string[]=[],kind:WorkloadOperation['kind']='REQUIRED',condition:string|null=null):WorkloadOperation=>({code,name,windows,methods,predecessors,kind,condition,weather:methods[0].capability==='DR'?'DRONE':methods[0].capability?'GROUND':'OUTDOOR_MANUAL'});
type SeedRow=[id:string,name:string,en:string,plant:MonthWindow,care:MonthWindow,harvest:MonthWindow[],plantMachine:WorkloadCapability|null,harvestMachine:WorkloadCapability|null,harvestMinutes:number];
// Independently authored, coarse scenario inputs. No region is automatically approved.
const fieldRows:SeedRow[]=[
 ['rice','쌀','Rice',w('05-10','06-10'),w('06-11','08-20'),[w('09-20','10-20')],'RP','CB',45],
 ['soybean','콩','Soybean',w('05-25','06-25'),w('06-26','08-31'),[w('10-01','11-10')],'SE','GC',60],
 ['barley','보리','Barley',w('10-10','11-10'),w('02-15','04-30',1),[w('05-20','06-20',1)],'SE','GC',45],
 ['wheat','밀','Wheat',w('10-10','11-10'),w('02-15','04-30',1),[w('06-01','06-30',1)],'SE','GC',45],
 ['maize','옥수수','Maize',w('04-10','05-20'),w('05-21','07-10'),[w('07-15','08-31')],'SE',null,180],
 ['potato','감자','Spring potato',w('03-15','04-20'),w('04-21','06-10'),[w('06-15','07-20')],'PS','PD',90],
 ['sweetpotato','고구마','Sweet potato',w('05-01','06-10'),w('06-11','08-31'),[w('09-15','10-31')],null,'RD',150],
 ['redbean','팥','Red bean',w('06-01','06-30'),w('07-01','08-31'),[w('10-01','10-31')],'SE',null,240],
 ['sesame','참깨','Sesame',w('05-01','05-31'),w('06-01','07-31'),[w('08-15','09-15')],'SE',null,300],
 ['perilla','들깨','Perilla seed',w('06-01','07-10'),w('07-11','09-15'),[w('10-01','10-31')],'SE',null,240],
 ['peanut','땅콩','Peanut',w('04-20','05-20'),w('05-21','08-20'),[w('09-15','10-20')],null,'RD',180],
 ['pepper','고추','Pepper',w('04-25','05-25'),w('05-26','07-20'),[w('07-21','08-10'),w('08-11','08-31'),w('09-01','09-20'),w('09-21','10-10')],null,null,360],
 ['garlic','마늘','Garlic',w('10-01','11-10'),w('02-15','05-01',1),[w('05-20','06-30',1)],null,'RD',240],
 ['onion','양파','Onion',w('10-10','11-20'),w('02-15','05-01',1),[w('05-20','06-30',1)],null,'RD',240],
 ['cabbage','배추','Autumn Chinese cabbage',w('08-10','09-10'),w('09-11','10-25'),[w('11-01','11-30')],null,null,240],
 ['radish','무','Autumn radish',w('08-10','09-10'),w('09-11','10-25'),[w('11-01','11-30')],'SE',null,240],
 ['green_onion','대파','Green onion',w('04-01','05-31'),w('06-01','08-31'),[w('09-01','10-15'),w('10-16','11-30')],null,null,300],
 ['head_cabbage','양배추','Cabbage',w('08-01','09-10'),w('09-11','10-20'),[w('10-21','11-30')],null,null,240],
 ['carrot','당근','Carrot',w('07-20','08-20'),w('08-21','10-20'),[w('10-21','11-30')],'SE',null,240],
 ['lettuce','상추','Open-field lettuce',w('03-15','04-15'),w('04-16','04-30'),[w('05-01','05-15'),w('05-16','05-31'),w('06-01','06-15')],null,null,300],
 ['spinach','시금치','Open-field spinach',w('09-01','09-30'),w('10-01','10-20'),[w('10-21','11-30')],'SE',null,180],
 ['broccoli','브로콜리','Broccoli',w('08-01','08-31'),w('09-01','10-15'),[w('10-16','11-30')],null,null,240],
 ['ginger','생강','Ginger',w('04-10','05-10'),w('05-11','09-30'),[w('10-01','11-10')],null,null,360],
 ['pumpkin','단호박','Winter squash',w('04-20','05-20'),w('05-21','07-10'),[w('07-11','08-10'),w('08-11','09-10')],null,null,180],
 ['watermelon','수박','Open-field watermelon',w('04-20','05-20'),w('05-21','07-10'),[w('07-11','08-20')],null,null,300],
];
function fieldCrop(row:SeedRow,index:number):WorkloadCrop{
 const [id,name,en,plant,care,harvest,pm,hm,hmMinutes]=row;
 const soilStart=new Date(`2000-${plant.from}T00:00:00Z`);soilStart.setUTCDate(soilStart.getUTCDate()-20);
 const soil=w(soilStart.toISOString().slice(5,10),plant.from,plant.yearOffset);
 const ops=[
  op('soil','토양 준비·경운',[soil],[machine('TR',45)]),
  op('plant',id==='rice'?'모 이앙':pm==='SE'?'파종':'파종·정식',[plant],[pm?machine(pm,60):manual(180)],['soil']),
  op('care','생육·잡초 관리',[care],[manual(120)],['plant']),
  op('scout','병해충 예찰',[care],[manual(30,1)],['plant'],'INSPECTION'),
  op('nutrition','양분 상태·시비 검토',[care],[manual(30,1)],['plant'],'INSPECTION'),
  op('fertilize','처방에 따른 시비',[care],[manual(60)],['nutrition'],'CONDITIONAL','토양·생육 진단과 처방 확인'),
  op('treat','예찰 후 방제',[care],[machine(id==='rice'?'DR':'GS',30)],['scout'],'CONDITIONAL','적용 작물·약제·사용시기·수확 전 안전간격·작업방식 확인'),
  op('harvest','수확',harvest,[hm?machine(hm,hmMinutes,1):manual(hmMinutes,3)],['plant']),
  op('finish','선별·수확물 정리',harvest,[manual(90)],['harvest']),
 ];
 return {id,name,en,category:index===0?'PADDY':index<11?'UPLAND':'VEGETABLE',practice:id==='perilla'?'종실용':id==='barley'||id==='wheat'||id==='garlic'||id==='onion'?'가을 식재·다음 해 수확':id==='potato'?'봄 재배':'노지 기준 작형',lifecycle:'SEASONAL',evidence:'SOURCE_REFERENCED_DEMO_PARAMETERS',regionalSuitability:'REVIEW_REQUIRED',serviceReview:'REVIEW_REQUIRED',sourceIds:['income','calendar','statistics','pesticide'],operations:ops};
}
const orchardRows:[string,string,string,MonthWindow[]][]=[
 ['apple','사과','Apple',[w('09-01','09-30'),w('10-01','11-10')]],
 ['pear','배','Pear',[w('09-01','10-20')]],
 ['peach','복숭아','Peach',[w('07-01','07-31'),w('08-01','08-31')]],
 ['grape','포도','Grape',[w('08-01','08-31'),w('09-01','10-10')]],
 ['plum','자두','Plum',[w('06-15','07-15'),w('07-16','08-15')]],
];
export const workloadCrops:WorkloadCrop[]=[...fieldRows.map(fieldCrop),...orchardRows.map(([id,name,en,harvest]):WorkloadCrop=>({
 id,name,en,category:'ORCHARD',practice:'기존 성목 과원·노지',lifecycle:'EXISTING_BEARING_ORCHARD',evidence:'SOURCE_REFERENCED_DEMO_PARAMETERS',regionalSuitability:'REVIEW_REQUIRED',serviceReview:'REVIEW_REQUIRED',sourceIds:['income','calendar','pesticide'],operations:[
  op('prune','겨울 전정',[w('01-15','03-10')],[manual(300)],[]),
  op('bloom','개화·착과 관리',[w('04-01','05-10')],[manual(240)],['prune']),
  op('thin','적과·생육 관리',[w('05-11','06-10')],[manual(300)],['bloom']),
  op('scout','병해충 예찰',[w('05-11','06-10')],[manual(30,1)],['bloom'],'INSPECTION'),
  op('nutrition','양분 상태·시비 검토',[w('03-01','04-30')],[manual(30,1)],[],'INSPECTION'),
  op('fertilize','처방에 따른 시비',[w('03-01','04-30')],[manual(90)],['nutrition'],'CONDITIONAL','토양·생육 진단과 처방 확인'),
  op('treat','예찰 후 방제',[w('05-11','06-10')],[machine('GS',45)],['scout'],'CONDITIONAL','수관·약제·수확 전 안전간격·안전작업 확인'),
  op('harvest','숙도 확인·수확',harvest,[manual(420,3)],['thin']),
  op('finish','선별·수확물 정리',harvest,[manual(150)],['harvest']),
  op('cleanup','수확 후 과원 정리',[w('11-11','12-10')],[manual(120)],['finish']),
 ]}))];
export const workloadCrop=(id:string)=>{const crop=workloadCrops.find(c=>c.id===id);if(!crop)throw Error('지원하지 않는 작업 기준 작물입니다.');return crop;};
