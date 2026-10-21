-- 005b_medications_fingerprints — empreintes 073 des 5 médicaments prédéterminés.
--
-- Complète `005_scales_fixed_ids.sql` : la colonne `source_fingerprint` naît
-- en 073, donc les empreintes ne peuvent être posées qu'après. Sans elles,
-- les lignes pré-insérées (empreinte NULL, ignorées par l'index partiel
-- `medications_source_fingerprint_uidx) seraient DUPLIQUÉES par le `ON
-- CONFLICT DO NOTHING` de 073 — et 090 retrouverait des UUID différents.
-- Rejoué par `provisionnement.ts` entre 073 et 074. Idempotent (UPDATE aux
-- mêmes valeurs). Aucune donnée patient.

BEGIN;

UPDATE app.medications SET source_fingerprint = 'e190d6f12adf88be22b751d96b6141b8a7537b84a11dd0ce1ef6c79397cf0323', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = '0a7eeb3f-61ba-4a2b-abb8-4ea4bb442088';
UPDATE app.medications SET source_fingerprint = 'a010aae0d2139b893e29f23c1d9aed91fa0441f751d6eb8a8075510b3049fecc', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = '2008839f-a73f-4bd6-a56b-4398512be770';
UPDATE app.medications SET source_fingerprint = 'e3f83bd26f947e5dec3b0a778063d09d077b312b22967799e654629a45b7638b', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = '41fa0d84-2c48-4881-9444-bc433b74bab1';
UPDATE app.medications SET source_fingerprint = '08e55ae3f04d029d1ea401e186ecb45b5864dc2c4b5a0f468292724845d2844b', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = '3ab17df5-a401-4348-98ab-978f461f16eb';
UPDATE app.medications SET source_fingerprint = 'c6c813f00f272ef1787856f74666a24fcadf9083b8c1b7d98d8f793c5228dc58', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = '276c77f4-ed6c-49d7-a4a0-8e12977c093e';
UPDATE app.medications SET source_fingerprint = '115d028b2a241d7fdb9f9dc546ed4a403998a3475b7ef6f0929f813aa347cb37', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = 'c2dd6bb7-00be-4121-a2e6-cc394ca1d167';
UPDATE app.medications SET source_fingerprint = '6064cd9a6cbfd861382c2b53a29afb529ca0657b409a5a7270e6903f33521682', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = 'f8ba9790-fad0-4fc2-b070-73c208e0ddfa';
UPDATE app.medications SET source_fingerprint = 'ff8f6e7dcd73da689458e2150ce86c6feca7cd2ebb714ebc2a6b906f44b12393', source_version = 'sha256:f20c36a91991ab88ff18fe87fc8c1b728a86c1ef791890c35d69d2e7fbeec85f' WHERE id = 'd41a0628-9cd6-4f9a-92ac-928cea2e69a8';

COMMIT;
