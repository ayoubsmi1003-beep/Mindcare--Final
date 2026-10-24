import { contextBridge, ipcRenderer } from 'electron';

/**
 * L'état de l'écran d'appairage.
 *
 * `manuelle` a été ajouté pour que le bloc « Le cabinet n'apparaît pas ? »
 * disparaisse dès qu'une confiance existe : sur un PC médecin en cours de
 * préparation, proposer de saisir un nom de PC n'aurait aucun sens.
 */
export interface EtatCabinet {
  readonly message: string;
  readonly premier: boolean;
  readonly invitation: boolean;
  readonly detail: string;
  readonly manuelle: boolean;
}

contextBridge.exposeInMainWorld('cabinet', {
  action: (action: string, code = '') => ipcRenderer.invoke('mindcare:cabinet-action', { action, code }),
  onEtat: (listener: (etat: EtatCabinet) => void) => {
    ipcRenderer.on('mindcare:cabinet-etat', (_event, etat: unknown) => {
      if (!etat || typeof etat !== 'object') return;
      const value = etat as Record<string, unknown>;
      if (typeof value.message === 'string' && typeof value.premier === 'boolean' && typeof value.invitation === 'boolean') {
        listener({
          message: value.message,
          premier: value.premier,
          invitation: value.invitation,
          detail: typeof value.detail === 'string' ? value.detail : '',
          manuelle: value.manuelle === true,
        });
      }
    });
  },
});
