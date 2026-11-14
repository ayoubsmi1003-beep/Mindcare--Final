import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { attendrePreparation } from '../../electron/main/orchestrateur';

describe('préparation du serveur après un démarrage lent', () => {
  it('réessaie une réponse temporairement indisponible avant de réussir', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(requests === 1 ? 503 : 307);
      res.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No server address');
      expect(await attendrePreparation(`http://127.0.0.1:${address.port}`, 3000)).toBe(true);
      expect(requests).toBeGreaterThanOrEqual(2);
    } finally {
      server.close();
    }
  });

  it('abandonne quand le serveur reste indisponible', async () => {
    const server = createServer((_req, res) => { res.writeHead(503); res.end(); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No server address');
      expect(await attendrePreparation(`http://127.0.0.1:${address.port}`, 250)).toBe(false);
    } finally {
      server.close();
    }
  });

  it('respecte une annulation avant la première tentative', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await attendrePreparation('http://127.0.0.1:1', 3000, controller.signal)).toBe(false);
  });
});
