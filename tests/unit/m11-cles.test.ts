import { describe, expect, it } from "vitest";
import { m11 } from "@/i18n/m11";

describe("m11 — chaînes", () => {
  it("expose toutes les clés palette/brief/journée", () => {
    expect(m11.palette.titre).toBe("Commande");
    expect(m11.palette.invite).toBe("Consigne pour Jarvis");
    expect(m11.palette.envoyer).toBe("Envoyer");
    expect(m11.palette.fermer).toBe("Fermer la commande");
    expect(m11.palette.ouvrir).toBe("Ouvrir la commande");
    expect(m11.palette.vide).toContain("même conversation que le panneau");
    expect(m11.brief.titre).toBe("Brief du matin");
    expect(m11.journee.aucunReste).toBe("Journée terminée — plus aucun créneau restant.");
    expect(m11.journee.sansDossier).toBe("Sans dossier");
  });

  it("compose les lignes de journée en français exact", () => {
    expect(m11.journee.pause("45 min", "10:30", "11:15")).toBe("Pause de 45 min (10:30–11:15).");
    expect(m11.journee.retard("Smail KARIM", 12)).toBe("Smail KARIM : arrivé avec 12 min de retard.");
    expect(m11.journee.reste(3, "14:00")).toBe("3 créneau(x) restant(s), prochain à 14:00.");
  });
});
