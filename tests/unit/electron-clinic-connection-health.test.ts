import { describe, expect, it, vi } from 'vitest';
import { creerSessionSondeCabinet, essayerConnexionCabinetConnu } from '../../electron/main/connexion-cabinet';

describe('connexion d’un poste déjà approuvé', () => {
  it('essaie directement l’origine approuvée avant de demander une découverte réseau', async () => {
    const connecter = vi.fn(async () => undefined);

    await expect(essayerConnexionCabinetConnu({ origin: 'https://cabinet.local:43118' }, connecter)).resolves.toBe(true);
    expect(connecter).toHaveBeenCalledExactlyOnceWith('https://cabinet.local:43118');
  });

  it('n’invente pas de connexion quand aucune origine approuvée n’est enregistrée', async () => {
    const connecter = vi.fn(async () => undefined);

    await expect(essayerConnexionCabinetConnu(undefined, connecter)).resolves.toBe(false);
    expect(connecter).not.toHaveBeenCalled();
  });

  it('retourne au parcours de récupération si la connexion directe échoue', async () => {
    const connecter = vi.fn(async () => { throw new Error('poste médecin indisponible'); });

    await expect(essayerConnexionCabinetConnu({ origin: 'https://cabinet.local:43118' }, connecter)).resolves.toBe(false);
    expect(connecter).toHaveBeenCalledExactlyOnceWith('https://cabinet.local:43118');
  });
});

describe('sonde réseau du cabinet', () => {
  it('utilise une session Electron non persistante isolée du renderer', async () => {
    const fetch = vi.fn(async () => ({ ok: true, text: async () => '{"ok":true}' }));
    const fromPartition = vi.fn(() => ({ fetch }));
    const sessionSonde = creerSessionSondeCabinet(fromPartition);
    const signal = AbortSignal.timeout(500);
    const init = { redirect: 'error' as const, credentials: 'omit' as const, headers: { 'Cache-Control': 'no-store' }, signal };

    await expect(sessionSonde.fetch('https://cabinet.local:43118/api/health', init)).resolves.toMatchObject({ ok: true });
    expect(fromPartition).toHaveBeenCalledExactlyOnceWith('mindcare-clinic-health', { cache: false });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cabinet.local:43118/api/health', init);
  });
});
