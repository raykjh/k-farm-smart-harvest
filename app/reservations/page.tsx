import Reservations from '@/components/reservations';
import WorkspaceRouteFrame from '@/components/workspace-route-frame';
// Retain the legacy URL, including the global administrator's read scope.
export default function Page(){return <WorkspaceRouteFrame active="장비"><Reservations/></WorkspaceRouteFrame>}
