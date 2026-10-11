import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

// Tests run the checked-out CP-SAT source, not an unknown background service.
export const testPython=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
if(!existsSync(testPython))throw Error('Python test environment missing: create .venv with Python 3.12, then install solver/requirements.txt before running pnpm test.');
