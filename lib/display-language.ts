import type {Machine} from './types';
import {equipmentTypes} from './equipment-register';

type Locale='ko'|'en';
const places:Record<string,string>={
 '전북특별자치도':'Jeonbuk Special Self-Governing Province','전라북도':'Jeollabuk-do','전북':'Jeonbuk',
 '장수군':'Jangsu-gun','계북면':'Gyebuk-myeon','장계면':'Janggye-myeon','천천면':'Cheoncheon-myeon','계남면':'Gyenam-myeon',
 '원촌리':'Wonchon-ri','농소리':'Nongso-ri','어전리':'Eojeon-ri','양악리':'Yangak-ri','임평리':'Impyeong-ri','매계리':'Maegye-ri','월현리':'Wolhyeon-ri',
 '서울특별시':'Seoul','부산광역시':'Busan','대구광역시':'Daegu','인천광역시':'Incheon','광주광역시':'Gwangju','대전광역시':'Daejeon','울산광역시':'Ulsan','세종특별자치시':'Sejong',
 '경기도':'Gyeonggi-do','강원특별자치도':'Gangwon Special Self-Governing Province','충청북도':'Chungcheongbuk-do','충청남도':'Chungcheongnam-do','전라남도':'Jeollanam-do','경상북도':'Gyeongsangbuk-do','경상남도':'Gyeongsangnam-do','제주특별자치도':'Jeju Special Self-Governing Province',
};
const initials=['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const vowels=['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const endings=['','k','k','ks','n','nj','nh','t','l','lk','lm','lp','ls','lt','lp','lh','m','p','ps','t','t','ng','t','t','k','t','p','h'];
/** Display fallback for authored place/name text, never an address lookup or a
 * change to the Korean source, cadastral identity, model name or stored record. */
export function romanizedText(text:string){
 return text.replace(/[가-힣]+/g,word=>{
  const value=[...word].map(char=>{const n=char.charCodeAt(0)-0xac00;return initials[Math.floor(n/588)]+vowels[Math.floor(n%588/28)]+endings[n%28]}).join('');
  return value.charAt(0).toUpperCase()+value.slice(1);
 });
}
export function addressText(value:string|undefined|null,locale:Locale):string{
 if(!value||locale==='ko'||!/[가-힣]/.test(value))return value??'';
 return value.trim().split(/\s+/).map(part=>{
  if(places[part])return places[part];
  const mountain=part.match(/^산(\d.*)$/);if(mountain)return `San ${mountain[1]}`;
  const administrative=part.match(/^([가-힣]+?)(대로|길|로|읍|면|동|리|군|구|시|도)$/);
  if(administrative){const suffix:Record<string,string>={'대로':'daero','길':'gil','로':'ro','읍':'eup','면':'myeon','동':'dong','리':'ri','군':'gun','구':'gu','시':'si','도':'do'};return `${romanizedText(administrative[1])}-${suffix[administrative[2]]}`;}
  return romanizedText(part);
 }).reverse().join(', ');
}
export function centerText(value:string|undefined|null,locale:Locale){
 if(!value||locale==='ko')return value??'';
 let result=value;
 for(const [ko,en] of Object.entries(places))result=result.replaceAll(ko,en);
 return romanizedText(result.replaceAll('농업지원센터','Agriculture Support Center').replaceAll('농협','Agricultural Cooperative').replaceAll('지점','Branch'));
}
const equipmentTerms:Record<string,string>={
 ...Object.fromEntries(equipmentTypes.map(([,ko,en])=>[ko,en])),
 '자율 트랙터':'Autonomous tractor','자율트랙터':'Autonomous tractor','운송차량':'Transport vehicle','드론':'Drone',
 '벼 콤바인':'Rice combine','승용 이앙기':'Riding rice transplanter','경운 로터리':'Rotary tiller',
 '방제드론':'Spraying drone','농업용 드론':'Agricultural drone','자율주행 트랙터':'Autonomous tractor','자율주행트랙터':'Autonomous tractor',
 '방제기':'Sprayer','파종기':'Seeder','굴취기':'Digger','수확기':'Harvester','자율':'Autonomous','공동':'Shared','예비':'Reserve',
};
export function equipmentText(value:string|undefined|null,locale:Locale){
 if(!value||locale==='ko')return value??'';
 let result=value;
 for(const [ko,en] of Object.entries(equipmentTerms).sort((a,b)=>b[0].length-a[0].length))result=result.replaceAll(ko,en);
 return romanizedText(result.replace(/(\d+)호(?:기)?/g,'No. $1')).replace(/\s+/g,' ').trim();
}
export const machineText=(machine:Pick<Machine,'name'>,locale:Locale)=>equipmentText(machine.name,locale);
