import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareCatalogue} from '../../scripts/lib/medication-reference.mjs';

describe('public reference catalogue preparation',()=>{
 it('preserves all canonical variants without reading configuration or connecting',()=>{
  const result=prepareCatalogue('docs/Médicaments.xlsx');
  expect(result.rows).toHaveLength(15645);
  expect(result.sourceRows).toBe(15661);
  expect(result.sourceVersion).toBe('sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f');
  expect(new Set(result.rows.map(r=>r.fp)).size).toBe(15645);
  expect(result.rows.filter(r=>/^ZOLOFT /i.test(r.raw)).length).toBeGreaterThan(1);
 });
 it('ships a preserving reference migration rather than replacement or clinical data',()=>{
  const sql=readFileSync('supabase/migrations/224_reference_medication_catalog.sql','utf8');
  expect(sql).toContain('DO NOTHING');
  expect(sql).not.toMatch(/DELETE|TRUNCATE|UPDATE app\.patients/);
 });
});
