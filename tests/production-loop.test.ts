import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../lib/production-sweep',()=>({refreshAllCenters:vi.fn(async()=>[])}));
import {refreshAllCenters} from '../lib/production-sweep';
import {startProductionLoop} from '../lib/production-loop';
afterEach(()=>{const g=globalThis as any;clearInterval(g.kfarmProductionLoop?.timer);delete g.kfarmProductionLoop;vi.useRealTimers();vi.clearAllMocks()});
it('starts only one draft worker and refreshes without a browser session',async()=>{
 vi.useFakeTimers();startProductionLoop();startProductionLoop();await vi.advanceTimersByTimeAsync(1);expect(refreshAllCenters).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(60000);expect(refreshAllCenters).toHaveBeenCalledTimes(2);
});
it('never overlaps slow calculations and retries after a failed tick',async()=>{
 vi.useFakeTimers();let reject!:(e:unknown)=>void;vi.mocked(refreshAllCenters).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r}));const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 startProductionLoop();await vi.advanceTimersByTimeAsync(1);await vi.advanceTimersByTimeAsync(60000);expect(refreshAllCenters).toHaveBeenCalledTimes(1);reject(Error('isolated error'));await vi.advanceTimersByTimeAsync(1);await vi.advanceTimersByTimeAsync(60000);expect(refreshAllCenters).toHaveBeenCalledTimes(2);log.mockRestore();
});
