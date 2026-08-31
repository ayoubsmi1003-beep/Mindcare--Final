/**
 * `vitest.config.ts` — LE PREMIER LANCEUR DE TESTS DE CE DÉPÔT.
 *
 * ═══ CE QU'IL AJOUTE, ET CE QU'IL NE REMPLACE PAS ═══
 *
 * La vérification vivait jusqu'ici dans `scripts/` : des `checkpoint-*.sql`
 * qui éprouvent la RLS EN BASE, et des `mesure-*.mjs` qui appellent les vraies
 * fonctions déployées. Ces deux familles restent la référence, et rien ici ne
 * les remplace : un test unitaire ne prouve NI une policy, NI qu'un fournisseur
 * répond. La leçon du dépôt est écrite noir sur blanc dans `STATE.md` — quinze
 * verts hors ligne recouvraient une chaîne qui n'avait jamais tourné.
 *
 * Ce lanceur couvre la zone que ni l'un ni l'autre n'atteint : la LOGIQUE PURE
 * qu'on ne peut pas éprouver sans exécuter le module — un contrat de frontière,
 * un filtre de citations, une machine à états, un budget de jetons. Ces
 * fonctions sont aujourd'hui vérifiées par relecture, ce qui est exactement la
 * méthode qui a laissé passer le décalage camelCase/snake_case entre
 * `get_patient_workspace` et `resume-cas.ts`.
 *
 * ⚠️ RÈGLE : UN TEST QUI N'ÉPROUVE QUE DES SIMULACRES NE COMPTE PAS. Si le
 * sujet d'un test est un `vi.fn()`, il mesure le test lui-même. Les tests d'ici
 * portent sur du code réel, avec des données de forme réelle.
 *
 * `environment: node` : ces modules ne touchent pas le DOM. Le navigateur est
 * couvert par les `mesure-*-navigateur.mjs`, qui conduisent un vrai Chromium.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    // `tests/integration/**` — ADR-001, phase 2. Ces tests-là EXIGENT une vraie
    // base PostgreSQL et ne simulent rien : le défaut qu'ils cherchent (une
    // identité qui survit à sa transaction et fuit vers la requête suivante)
    // vit dans le comportement de PostgreSQL et du pilote, pas dans notre code.
    // Un simulacre prouverait seulement que le simulacre est cohérent.
    //
    // Sans `MINDCARE_TEST_DATABASE_URL`, ils s'IGNORENT en le disant — ils ne
    // passent pas au vert en silence. C'est la même exigence que les
    // `checkpoint-*.sql` : ce qu'on ne peut pas prouver n'est pas vert.
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // L'ouverture d'une connexion et l'entrelacement volontaire dépassent le
    // défaut de 5 s sur un poste chargé.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Aucune donnée patient ne doit jamais atteindre un test : les fixtures
    // sont écrites à la main dans les fichiers de test, jamais lues en base.
    watch: false,
  },
});
