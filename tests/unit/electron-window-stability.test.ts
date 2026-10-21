import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ fetch: vi.fn(), windows: vi.fn(), closed: vi.fn() }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'synthetic-profile', on: vi.fn() },
  BrowserWindow: fixture.windows, dialog: {}, ipcMain: { handle: vi.fn() },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  session: { defaultSession: { setCertificateVerifyProc: vi.fn() }, fromPartition: () => ({ fetch: fixture.fetch, setCertificateVerifyProc: vi.fn() }) },
}));
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, mkdirSync: vi.fn(), existsSync: () => true, readFileSync: (file: string, ...args: unknown[]) => {
    if (file.endsWith('desktop.json')) return '{"mode":"client"}';
    if (file.endsWith('clinic-trust.json')) return JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', origin: 'https://doctor.local:43118', certificate: 'synthetic-certificate' });
    return real.readFileSync(file, ...(args as ['utf8']));
  } };
});
vi.mock('../../electron/main/confiance-cabinet', () => ({ verifierCertificatCabinet: () => true }));
vi.mock('../../electron/main/connexion-cabinet', async importOriginal => ({
  ...await importOriginal<typeof import('../../electron/main/connexion-cabinet')>(),
  attendreCabinet: async () => { fixture.fetch(); throw new Error('CABINET_INJOIGNABLE'); },
}));
afterEach(() => vi.useRealTimers());
it('keeps the same main window visible during repeated API outages and never opens discovery', async () => {
  vi.useFakeTimers();
  const { connecterBureauCabinet, surveillerCabinet } = await import('../../electron/main/bureau-cabinet');
  await connecterBureauCabinet();
  const window = { hide: vi.fn(), show: vi.fn(), isDestroyed: () => false, getTitle: () => 'MindCare OS', setTitle: vi.fn(), webContents: { send: vi.fn() }, once: fixture.closed };
  surveillerCabinet(window as never);
  await vi.advanceTimersByTimeAsync(21000);
  expect(window.hide).not.toHaveBeenCalled();
  expect(window.show).not.toHaveBeenCalled();
  expect(fixture.windows).not.toHaveBeenCalled();
  expect(fixture.closed).toHaveBeenCalledWith('closed', expect.any(Function));
});
