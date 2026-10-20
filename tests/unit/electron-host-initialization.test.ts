import { describe,expect,it } from 'vitest';
import { autoriserInitialisation } from '../../electron/main/proxy-cabinet';
import { finaliserCabinetNeuf, type CibleProvisionnement } from '../../electron/main/provisionnement';
describe('host initialization boundary',()=>{
  it('allows first account creation only on the physical host',()=>{
    expect(autoriserInitialisation('127.0.0.1','127.0.0.1')).toBe(true);
    expect(autoriserInitialisation('::ffff:192.168.1.4','::ffff:192.168.1.4')).toBe(true);
    expect(autoriserInitialisation('192.168.1.5','192.168.1.4')).toBe(false);
    expect(autoriserInitialisation(undefined,'192.168.1.4')).toBe(false);
  });
  it('never runs fixture cleanup against an existing cluster',async()=>{
    const cible: CibleProvisionnement = {bin:{initdb:'unused',pgCtl:'unused',psql:'unused',postgres:'unused',pgRestore:'unused'},hote:'127.0.0.1',port:54489,base:'unused',superutilisateur:'unused',motDePasseSuperutilisateur:'unused'};
    await expect(finaliserCabinetNeuf(cible,'unused',false)).rejects.toThrow(/existante/);
  });
});
