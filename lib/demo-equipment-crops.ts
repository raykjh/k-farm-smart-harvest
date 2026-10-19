import type {SupportedCropCode} from './crop-registry';

// Explicit synthetic resource input, not a model/manufacturer compatibility
// claim. Never use these defaults for ordinary equipment registration.
export const demoEquipmentCrops:Readonly<Record<string,readonly SupportedCropCode[]>>={
 TR:['rice','potato','pepper'],DR:['rice','potato','pepper'],RP:['rice'],
 PS:['potato'],CB:['rice'],PD:['potato'],SP:['rice','potato','pepper'],TV:[],
};
