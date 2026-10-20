import './globals.css';
import './workspace-ui.css';
import {LanguageProvider} from '@/components/language';
import {AccountBar} from '@/components/account-ui';
import {connection} from 'next/server';
import {judgeAccessConfig} from '@/lib/judge-access-config';
export const metadata={title:'K-Farm | 지역 농업 지원센터',description:'AI와 지역 센터가 연결하는 작물·일정·장비·인력 관리'};
export default async function RootLayout({children}:{children:React.ReactNode}){await connection();const locale=judgeAccessConfig()?'en':'ko';return <html lang={locale}><body><LanguageProvider defaultLocale={locale}><AccountBar/>{children}</LanguageProvider></body></html>}
