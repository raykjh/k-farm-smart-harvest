import {centerId} from './workspace';
/** New centers must supply a verified grid; never inherit Gyebuk coordinates. */
export function centerWeatherConfig(id=centerId(),env:Record<string,string|undefined>=process.env){
 const prefix=id==='demo'?'KMA':`KMA_${id.toUpperCase()}`;
 return {key:env.KMA_SERVICE_KEY,nx:env[`${prefix}_GRID_NX`],ny:env[`${prefix}_GRID_NY`]};
}
