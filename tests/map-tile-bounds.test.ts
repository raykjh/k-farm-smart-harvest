import {expect,it} from 'vitest';
import {allowedMapTile} from '../lib/map-tile-bounds';
const tile=(lon:number,lat:number,z:number)=>[z,Math.floor((lon+180)/360*2**z),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z)] as const;
it('supports nationwide overviews and Seoul, Jeju and Busan without arbitrary worldwide proxying',()=>{
 for(const [lon,lat] of [[126.98,37.56],[126.53,33.5],[129.07,35.18],[127.62,35.78]])for(const z of [6,11,18])expect(allowedMapTile(...tile(lon,lat,z))).toBe(true);
 expect(allowedMapTile(...tile(-74,40.7,11))).toBe(false);expect(allowedMapTile(5,1,1)).toBe(false);expect(allowedMapTile(6,64,10)).toBe(false);expect(allowedMapTile(6,1.5,10)).toBe(false);
});
