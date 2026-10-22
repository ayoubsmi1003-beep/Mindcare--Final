import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('cabinet', {
  action: (action: string, code = '') => ipcRenderer.invoke('mindcare:cabinet-action', { action, code }),
  onEtat: (listener: (etat: {message: string; premier: boolean; invitation: boolean; detail: string}) => void) => {
    ipcRenderer.on('mindcare:cabinet-etat', (_event, etat: unknown) => {
      if (!etat || typeof etat !== 'object') return;
      const value = etat as Record<string, unknown>;
      if (typeof value.message === 'string' && typeof value.premier === 'boolean' && typeof value.invitation === 'boolean') {
        listener({
          message: value.message,
          premier: value.premier,
          invitation: value.invitation,
          detail: typeof value.detail === 'string' ? value.detail : '',
        });
      }
    });
  },
});
