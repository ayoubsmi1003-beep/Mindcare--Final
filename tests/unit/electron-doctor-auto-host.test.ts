import { describe, expect, it } from 'vitest';
import { initialiserHoteDocteur } from '../../electron/main/recherche-cabinet';

describe('doctor delivery first launch', () => {
  it('starts the doctor host only on a truly unconfigured PC with the doctor marker', () => {
    expect(initialiserHoteDocteur(true, false, false, false)).toBe(true);
    expect(initialiserHoteDocteur(false, false, false, false)).toBe(false);
    expect(initialiserHoteDocteur(true, true, false, false)).toBe(false);
    expect(initialiserHoteDocteur(true, false, true, false)).toBe(false);
    expect(initialiserHoteDocteur(true, false, false, true)).toBe(false);
  });
});
