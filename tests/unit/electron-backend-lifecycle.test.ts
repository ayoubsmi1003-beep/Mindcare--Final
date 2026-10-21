import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { arreterBackend, observerSortieBackend } from '../../electron/main/processus-backend';

describe('owned backend lifecycle', () => {
  it('awaits an intentional child exit without reporting it as a crash', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true });
    await once(child, 'spawn');
    const crash = vi.fn();
    observerSortieBackend(child, crash);
    await arreterBackend(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(crash).not.toHaveBeenCalled();
    await arreterBackend(child);
    expect(crash).not.toHaveBeenCalled();
  });
  it('reports an unexpected exit with its actual code', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(7),100)'], { windowsHide: true });
    const crash = vi.fn();
    observerSortieBackend(child, crash);
    await once(child, 'close');
    expect(crash).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('code 7'));
  });
  it('releases an owned listener before allowing recovery to continue', async () => {
    const child = spawn(process.execPath, ['-e', "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"], { windowsHide: true });
    const [data] = await once(child.stdout, 'data');
    const port = Number(String(data).trim());
    await arreterBackend(child);
    const { createServer } = await import('node:net');
    const replacement = createServer();
    try { await new Promise<void>((resolve, reject) => replacement.once('error', reject).listen(port, '127.0.0.1', resolve)); }
    finally { await new Promise<void>(resolve => replacement.close(() => resolve())); }
  });
});
