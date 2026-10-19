'use client';
import {useEffect,useState} from 'react';
import Dashboard from './dashboard';
import Registration from './registration';
import WorkspaceRouteFrame from './workspace-route-frame';
// Existing consultation links retain their editor and saved records.
export default function RegistrationEntry(){
 const [legacy,setLegacy]=useState<boolean|null>(null);
 useEffect(()=>setLegacy(new URLSearchParams(location.search).has('consultation')),[]);
 if(legacy===null)return null;
 return legacy?<WorkspaceRouteFrame active="농지·농가"><Registration/></WorkspaceRouteFrame>:<Dashboard initialRegistration/>;
}
