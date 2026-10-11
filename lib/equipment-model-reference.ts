import type {Bilingual, EquipmentKind} from './operating-information';
export type EquipmentModelReference={
 id:string;kind:EquipmentKind;manufacturer:string;model:string;sourceUrl:string;checkedOn:string;
 specs:{label:Bilingual;value:Bilingual}[];automation:Bilingual;limitation:Bilingual;
 // Reference specifications never imply center ownership, compatibility or an approved rate.
 capacityHaHour:null;automaticallyApplied:false;
};
export const equipmentModelReferences:EquipmentModelReference[]=[
 {id:'dji-agras-t50',kind:'DR',manufacturer:'DJI',model:'AGRAS T50',sourceUrl:'https://ag.dji.com/t50/specs',checkedOn:'2026-10-03',
  specs:[{label:['약제 탱크','Spray tank'],value:['40 L','40 L']},{label:['살포 적재량','Spraying payload'],value:['40 kg (제조사 조건)','40 kg (manufacturer conditions)']},{label:['배터리 포함 중량','Weight including battery'],value:['52 kg','52 kg']},{label:['접은 크기','Folded dimensions'],value:['1,115 × 750 × 900 mm','1,115 × 750 × 900 mm']},{label:['제조사 최대 내풍성','Manufacturer max wind resistance'],value:['6 m/s · 방제 허용 풍속 아님','6 m/s · not a spraying safety threshold']}],
  automation:['경로 기반 자동 작업 기능 · 현장 운영자 필요','Route-based automated operation; on-site operator required'],
  limitation:['최대 내풍성을 방제 허용치로 쓰지 않습니다. 약제·비산·비행 조건을 별도로 검토하며, 탱크 용량으로 시간당 처리면적을 추정하지 않습니다.','Wind resistance is not permission to spray. Review product, drift and flight conditions separately. Tank size does not determine area throughput.'],capacityHaHour:null,automaticallyApplied:false},
 {id:'daedong-drp80ma',kind:'RP',manufacturer:'DAEDONG',model:'DRP80MA',sourceUrl:'https://ko.daedong.co.kr/product/27',checkedOn:'2026-10-03',
  specs:[{label:['식부 열수','Planting rows'],value:['8조','8 rows']},{label:['호칭 출력','Rated power'],value:['24 PS','24 PS']},{label:['작업속도','Working speed'],value:['1.6 m/s','1.6 m/s']},{label:['무부하 중량','Unloaded weight'],value:['930 kg','930 kg']},{label:['길이 × 폭 × 높이','Length × width × height'],value:['3,520 × 2,670 × 2,300 mm','3,520 × 2,670 × 2,300 mm']}],
  automation:['DRP80MA 직진자동 기능 · 무인 전체 작업을 의미하지 않음','Straight-line automation on DRP80MA; not fully unattended operation'],
  limitation:['DRP80MA 형식의 제원입니다. 속도를 ha/시간으로 그대로 바꾸지 않으며 회차·모 보급·논 상태와 운영자를 별도로 확인합니다.','Specifications refer to DRP80MA. Do not convert speed directly to ha/h; verify turning, seedling supply, field conditions and operator requirements.'],capacityHaHour:null,automaticallyApplied:false},
 {id:'daedong-dh6135-a',kind:'CB',manufacturer:'DAEDONG',model:'DH6135-A',sourceUrl:'https://ko.daedong.co.kr/product/489',checkedOn:'2026-10-03',
  specs:[{label:['예취 열수','Harvesting rows'],value:['6조','6 rows']},{label:['엔진 출력','Engine power'],value:['143 PS','143 PS']},{label:['곡물 탱크','Grain tank'],value:['2,000 L','2,000 L']},{label:['연료 탱크','Fuel tank'],value:['129 L','129 L']}],
  automation:['제조사 직진·선회 자율작업 기능 · 사전 수동 작업 및 현장 운영자 필요','Manufacturer straight / turning automation; manual field preparation and on-site operator required'],
  limitation:['벼용 모델의 참고 제원입니다. 다른 곡물 호환이나 K-Farm 원격제어 연결을 뜻하지 않습니다. 수확·배출·운송 시간은 별도 확인합니다.','Reference specifications for rice harvesting; not proof of other-grain compatibility or K-Farm remote control. Verify harvesting, unloading and transport times separately.'],capacityHaHour:null,automaticallyApplied:false},
];
