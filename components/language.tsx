'use client';
import {createContext,useContext,useEffect,useState,Children,isValidElement,cloneElement,type ReactNode,type ReactElement} from 'react';
import {translate} from '@/lib/i18n';
export type Locale='ko'|'en';
const LanguageContext=createContext<{locale:Locale;setLocale:(l:Locale)=>void}>({locale:'ko',setLocale:()=>{}});
export function LanguageProvider({children}:{children:ReactNode}){
 const [locale,setLanguage]=useState<Locale>('ko');
 useEffect(()=>{try{if(localStorage.getItem('kfarm.locale')==='en')setLanguage('en')}catch{}},[]);
 useEffect(()=>{document.documentElement.lang=locale;document.title=locale==='ko'?'K-Farm | 지역 농업 지원센터':'K-Farm | Regional Agriculture Support Center'},[locale]);
 function setLocale(l:Locale){setLanguage(l);try{localStorage.setItem('kfarm.locale',l)}catch{}}
 return <LanguageContext.Provider value={{locale,setLocale}}>{children}</LanguageContext.Provider>;
}
export const useLanguage=()=>useContext(LanguageContext);
export function LanguageSelector(){const {locale,setLocale}=useLanguage();return <label className="language-selector"><span>언어 / Language</span><select aria-label="언어 / Language" value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="ko">한국어</option><option value="en">English</option></select></label>}
// Translate presentation nodes only. Event handlers, IDs, option values and API data stay unchanged.
// A pure React render transform, not DOM mutation or a network translation service.
export function localized(node:ReactNode,locale:Locale):ReactNode{
 if(locale==='ko')return node;
 if(typeof node==='string')return translate(node);
 if(Array.isArray(node))return Children.map(node,n=>localized(n,locale));
 if(!isValidElement(node))return node;
 const el=node as ReactElement<Record<string,unknown>>;
 const props:Record<string,unknown>={};
 for(const key of ['aria-label','title','placeholder'])if(typeof el.props[key]==='string')props[key]=translate(el.props[key] as string);
 if('children' in el.props)props.children=localized(el.props.children as ReactNode,locale);
 return cloneElement(el,props);
}
