import './globals.css';
import './workspace-ui.css';
import {LanguageProvider} from '@/components/language';
import {AccountBar} from '@/components/account-ui';
export const metadata={title:'K-Farm | 지역 농업 지원센터',description:'공동영농 운영 데모 — 실제 장비와 문자를 실행하지 않습니다.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body><LanguageProvider><AccountBar/>{children}</LanguageProvider></body></html>}
