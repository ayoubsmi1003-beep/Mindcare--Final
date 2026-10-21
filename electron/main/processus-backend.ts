import type { ChildProcess } from 'node:child_process';

const arretsDemandes = new WeakSet<ChildProcess>();

/** Recovery and shutdown are intentional exits, not supervisor failures. */
export function observerSortieBackend(backend: ChildProcess, onCrash: (detail: string) => void): void {
  backend.once('exit', (code, signal) => {
    if (!arretsDemandes.has(backend)) onCrash(`backend terminé (code ${String(code)}, signal ${String(signal)})`);
  });
  backend.once('error', () => { if (!arretsDemandes.has(backend)) onCrash('BACKEND_SPAWN_ERROR'); });
}

/** Wait for this owned child only; never stop a shared PostgreSQL service. */
export async function arreterBackend(backend: ChildProcess | undefined): Promise<void> {
  if (!backend || backend.exitCode !== null || backend.signalCode !== null) return;
  arretsDemandes.add(backend);
  await new Promise<void>((resolve, reject) => {
    const terminer = () => { clearTimeout(timer); backend.removeListener('error', erreur); resolve(); };
    const erreur = () => { clearTimeout(timer); backend.removeListener('close', terminer); reject(new Error('BACKEND_STOP_FAILED')); };
    const timer = setTimeout(() => {
      backend.removeListener('close', terminer); backend.removeListener('error', erreur);
      reject(new Error('BACKEND_STOP_TIMEOUT'));
    }, 5000);
    backend.once('close', terminer);
    backend.once('error', erreur);
    try { if (!backend.kill()) erreur(); } catch { erreur(); }
  });
}
