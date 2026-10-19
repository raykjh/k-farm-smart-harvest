import {Login} from '@/components/account-ui';
import {connection} from 'next/server';
import {judgeLoginDefaults} from '@/lib/judge-access';
export default async function Page(){await connection();return <Login defaultCredentials={await judgeLoginDefaults()}/>}
