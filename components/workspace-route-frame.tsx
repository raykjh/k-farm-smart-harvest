'use client';
import type {ReactNode} from 'react';
import WorkspaceSidebar,{type WorkspaceView} from './workspace-sidebar';
import {useReferenceData} from './information-shared';
import type {Principal} from '@/lib/auth';

// Standalone editors retain the same navigation without mounting dashboard workers.
export default function WorkspaceRouteFrame({active,children}:{active:WorkspaceView|'crop-info'|'equipment-info';children:ReactNode}){
 const {data}=useReferenceData<{user:Principal|null}>('/api/auth');
 return <div className="shell workspace-route-frame"><WorkspaceSidebar active={active} globalOnly={data?.user?.role==='SUPER_ADMIN'}/><div className="content">{children}</div></div>;
}
