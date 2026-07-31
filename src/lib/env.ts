/**
 * Validation des variables d'environnement client (I1).
 * Échec explicite et immédiat si une variable requise manque.
 * Ne jamais logger la valeur d'une variable — uniquement son nom.
 */

interface ClientEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

function readRequired(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Configuration invalide : la variable d'environnement ${name} est manquante.`,
    );
  }
  return value;
}

export function getClientEnv(): ClientEnv {
  return {
    supabaseUrl: readRequired(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env["NEXT_PUBLIC_SUPABASE_URL"],
    ),
    supabaseAnonKey: readRequired(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ),
  };
}
