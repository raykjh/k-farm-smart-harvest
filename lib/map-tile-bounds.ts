/** Authenticated basemap browsing for Korea and the surrounding viewport. */
export function allowedMapTile(z:number,x:number,y:number){
 if(![z,x,y].every(Number.isInteger)||z<6||z>18||x<0||y<0||x>=2**z||y>=2**z)return false;
 const longitude=(column:number)=>column/2**z*360-180;
 const latitude=(row:number)=>Math.atan(Math.sinh(Math.PI*(1-2*row/2**z)))*180/Math.PI;
 return longitude(x)<=150&&longitude(x+1)>=110&&latitude(y)>=20&&latitude(y+1)<=50;
}
