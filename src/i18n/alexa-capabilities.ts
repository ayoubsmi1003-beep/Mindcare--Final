/** Plain answers for features this application doesn't have. */
export const absentFeatureCopy = {
  invoices: "Le cabinet n’utilise pas de factures dans MindCare : seuls les paiements et les charges y sont enregistrés. Je peux vous donner les encaissements ou les paiements en attente.",
  refunds: "MindCare ne gère ni remboursement ni annulation d’un paiement encaissé. Je peux vous montrer les paiements enregistrés.",
  financial_goals: "Aucun objectif financier n’existe dans MindCare. Je peux vous donner les recettes et les charges enregistrées.",
  payment_aging: "MindCare ne calcule pas l’ancienneté des impayés. Je peux vous donner les paiements en attente.",
} as const;
