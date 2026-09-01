/**
 * Windows sans « mode developpeur » : `fs.symlink` -> jonction NTFS.
 *
 * POURQUOI CE MODULE EXISTE. La sortie autonome de Next (`output:
 * "standalone"`) reconstruit l'arborescence `node_modules` tracee. Sous pnpm,
 * cette arborescence est faite de LIENS SYMBOLIQUES vers le magasin, et Next
 * les recree a l'identique. Or creer un lien symbolique sous Windows exige le
 * privilege `SeCreateSymbolicLinkPrivilege` : sans le mode developpeur ni
 * elevation, Node rend `EPERM` et `next build` echoue.
 *
 * CE QUE CE MODULE FAIT, ET RIEN DE PLUS. Il ne desactive rien et ne masque
 * aucune erreur : sur `EPERM`, et uniquement pour un lien de REPERTOIRE, il
 * rejoue l'appel en JONCTION NTFS. Une jonction pointe un repertoire absolu
 * et se traverse exactement comme un lien symbolique de repertoire — c'est le
 * mecanisme que pnpm et npm utilisent eux-memes sous Windows pour la meme
 * raison. Toute autre erreur, et tout lien de FICHIER, remontent intacts.
 *
 * Applique par `--import` au seul processus d'empaquetage
 * (`scripts/preparer-paquet.mjs`) : ni `pnpm dev`, ni `pnpm build`, ni le
 * code livre n'en voient la couleur.
 */
import fs from "node:fs";
import path from "node:path";

const estRepertoire = (type) => type === undefined || type === null || type === "dir";

// Une jonction exige une cible ABSOLUE ; un lien symbolique accepte le relatif.
const absolue = (cible, lien) =>
  path.isAbsolute(cible) ? cible : path.resolve(path.dirname(lien), cible);

const symlinkSyncOrigine = fs.symlinkSync.bind(fs);
fs.symlinkSync = (cible, lien, type) => {
  try {
    return symlinkSyncOrigine(cible, lien, type);
  } catch (e) {
    if (e?.code !== "EPERM" || !estRepertoire(type)) throw e;
    return symlinkSyncOrigine(absolue(cible, lien), lien, "junction");
  }
};

const symlinkPromiseOrigine = fs.promises.symlink.bind(fs.promises);
fs.promises.symlink = async (cible, lien, type) => {
  try {
    return await symlinkPromiseOrigine(cible, lien, type);
  } catch (e) {
    if (e?.code !== "EPERM" || !estRepertoire(type)) throw e;
    return symlinkPromiseOrigine(absolue(cible, lien), lien, "junction");
  }
};

const symlinkOrigine = fs.symlink.bind(fs);
fs.symlink = (cible, lien, typeOuRappel, peutEtreRappel) => {
  const type = typeof typeOuRappel === "function" ? undefined : typeOuRappel;
  const rappel = typeof typeOuRappel === "function" ? typeOuRappel : peutEtreRappel;
  symlinkOrigine(cible, lien, type, (e) => {
    if (e && e.code === "EPERM" && estRepertoire(type)) {
      symlinkOrigine(absolue(cible, lien), lien, "junction", rappel);
      return;
    }
    rappel(e);
  });
};
