/** The only PostgreSQL target permitted by the installed clinic host. */
export const PORT_POSTGRES_CABINET = 54333;
export const HOTE_POSTGRES_CABINET = "127.0.0.1";
export const NOM_BASE_CABINET = "mindcare";

/**
 * Validate the effective production URL before any PostgreSQL client is
 * started. Query parameters and fragments are rejected because libpq/pg may
 * use them to override the authority in the URL.
 */
export function cibleBasePostgresProductionValide(valeur: string): boolean {
  try {
    const url = new URL(valeur);
    return (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname === HOTE_POSTGRES_CABINET &&
      url.port === String(PORT_POSTGRES_CABINET) &&
      url.pathname === `/${NOM_BASE_CABINET}` &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
