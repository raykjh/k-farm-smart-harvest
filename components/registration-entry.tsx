'use client';
import {useEffect,useState} from 'react';
import Dashboard from './dashboard';
import Registration from './registration';
// Existing consultation links retain their editor and saved records.
export default function RegistrationEntry(){
 const [legacy,setLegacy]=useState<boolean|null>(null);
 useEffect(()=>setLegacy(new URLSearchParams(location.search).has('consultation')),[]);
 if(legacy===null)return null;
 return legacy?<Registration/>:<Dashboard initialRegistration/>;
}
