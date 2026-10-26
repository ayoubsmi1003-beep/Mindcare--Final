import { describe, expect, it } from 'vitest';
import { filteredPatientCountParagraph } from '@/i18n/alexa-patient-query';
import { requestsCabinetWideScope, withoutCabinetWideScope } from '@/shared/alexa/request-plan';

describe('Alexa query wording', () => {
  it.each([
    ['eq', 0, 'avec un solde de 0 DZD'],
    ['gt', 0, 'avec un solde impayé'],
    ['gt', 100, 'avec un solde supérieur à 100 DZD'],
    ['gte', 100, 'avec un solde supérieur ou égal à 100 DZD'],
    ['lt', 100, 'avec un solde inférieur à 100 DZD'],
    ['lte', 100, 'avec un solde inférieur ou égal à 100 DZD'],
  ] as const)('describes balance operator %s faithfully', (op, value, expected) => {
    expect(filteredPatientCountParagraph(5, 'active', [{ field: 'outstanding_balance', op, value }]))
      .toBe(`Parmi les patients actifs, 5 répondent aux critères : ${expected}.`);
  });

  it.each([
    'Quels certificats ont été émis dans l’ensemble du cabinet ?',
    'Quels certificats ont été émis à l’échelle de l’ensemble du cabinet ?',
    'Quels certificats ont été émis pour tout le cabinet ?',
  ])('recognizes explicit cabinet-wide scope: %s', (question) => {
    expect(requestsCabinetWideScope(question)).toBe(true);
    expect(withoutCabinetWideScope(question)).not.toMatch(/cabinet/iu);
  });

  it('preserves a patient name when removing cabinet-wide scope language', () => {
    expect(withoutCabinetWideScope('Liste les documents de Nadia Test pour tout le cabinet'))
      .toContain('Nadia Test');
  });
});
