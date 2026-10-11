import {z} from 'zod';
/** Stable codes used by registration, cultivation, planning and notifications.
 * Inclusion is software support, not regional agronomic approval. */
export const cropCodes=['rice','potato','pepper','soybean','barley','wheat','maize','sweetpotato','redbean','sesame','perilla','peanut','garlic','onion','cabbage','radish','green_onion','head_cabbage','carrot','lettuce','spinach','broccoli','ginger','pumpkin','watermelon','apple','pear','peach','grape','plum'] as const;
export type SupportedCropCode=typeof cropCodes[number];
export const cropCodeSchema=z.enum(cropCodes);
export const optionalCropSchema=z.union([z.literal(''),cropCodeSchema]);
export const cropNames={rice:'쌀',potato:'감자',pepper:'고추',soybean:'콩',barley:'보리',wheat:'밀',maize:'옥수수',sweetpotato:'고구마',redbean:'팥',sesame:'참깨',perilla:'들깨',peanut:'땅콩',garlic:'마늘',onion:'양파',cabbage:'배추',radish:'무',green_onion:'대파',head_cabbage:'양배추',carrot:'당근',lettuce:'상추',spinach:'시금치',broccoli:'브로콜리',ginger:'생강',pumpkin:'단호박',watermelon:'수박',apple:'사과',pear:'배',peach:'복숭아',grape:'포도',plum:'자두'} as const;
export type CropName=typeof cropNames[SupportedCropCode];
export const cropEnglish:Record<SupportedCropCode,string>={rice:'Rice',potato:'Spring potato',pepper:'Pepper',soybean:'Soybean',barley:'Barley',wheat:'Wheat',maize:'Maize',sweetpotato:'Sweet potato',redbean:'Red bean',sesame:'Sesame',perilla:'Perilla seed',peanut:'Peanut',garlic:'Garlic',onion:'Onion',cabbage:'Chinese cabbage',radish:'Radish',green_onion:'Green onion',head_cabbage:'Cabbage',carrot:'Carrot',lettuce:'Lettuce',spinach:'Spinach',broccoli:'Broccoli',ginger:'Ginger',pumpkin:'Winter squash',watermelon:'Watermelon',apple:'Apple',pear:'Pear',peach:'Peach',grape:'Grape',plum:'Plum'};
export const cropDisplayNames=(ko:boolean):Record<SupportedCropCode,string>=>ko?cropNames:cropEnglish;
export function cropEnglishName(name:string){const code=cropCodes.find(c=>cropNames[c]===name);return code?cropEnglish[code]:name;}
export const legacyCropCodes=['rice','potato','pepper'] as const;
export type LegacyCropCode=typeof legacyCropCodes[number];
export const isLegacyCrop=(crop:string):crop is LegacyCropCode=>(legacyCropCodes as readonly string[]).includes(crop);
export function cropLabel(crop:string){return cropNames[crop as SupportedCropCode]??crop;}
export const isOrchardCrop=(crop:string)=>['apple','pear','peach','grape','plum'].includes(crop);
