/**
 * Signature webhook — HMAC-SHA256 hex du corps BRUT.
 *
 * Serveur uniquement (`node:crypto`, jamais importé côté client). La
 * comparaison est à temps constant : une comparaison naïve fuirait le
 * préfixe valide octet par octet (oracle temporel sur le secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Calcule la signature attendue d'un corps (tests + route). */
export function signerCharge(secret: string, corpsBrut: string): string {
  return createHmac("sha256", secret).update(corpsBrut, "utf8").digest("hex");
}

/**
 * Vérifie l'en-tête `x-comm-signature`. Secret vide → false systématique :
 * sans secret configuré, la route exige déjà une session (jamais d'ingestion
 * anonyme par défaut).
 */
export function verifierSignatureWebhook(
  secret: string,
  corpsBrut: string,
  signatureRecue: string,
): boolean {
  if (secret === "" || signatureRecue === "") return false;
  const attendue = signerCharge(secret, corpsBrut);
  const a = Buffer.from(attendue, "utf8");
  const b = Buffer.from(signatureRecue, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
