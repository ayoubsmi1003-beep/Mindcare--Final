import { expect, it } from "vitest";

import { etatParRecu, type NotificationItem } from "@/services/notifications";

function notification(
  id: string,
  receipt: string | null,
  readAt: string | null,
  createdAt: string,
): NotificationItem {
  return {
    id,
    kind: "payment_due",
    payload: receipt === null ? {} : { receipt_number: receipt, amount_dzd: 4000 },
    readAt,
    createdAt,
  };
}

it("rend un seul état par reçu, et garde le non-lu plutôt que le plus récent lu", () => {
  const etats = etatParRecu([
    notification("recent-lu", "REC-1", "2026-10-07T22:10:00Z", "2026-10-07T22:10:00Z"),
    notification("ancien-non-lu", "REC-1", null, "2026-10-07T20:00:00Z"),
    notification("autre", "REC-2", null, "2026-10-06T09:00:00Z"),
  ]);

  expect(etats).toHaveLength(2);
  expect(etats.map((n) => n.id)).toEqual(["ancien-non-lu", "autre"]);
  expect(etats[0]?.readAt).toBeNull();
});

it("garde la correction la plus récente quand toutes les lignes du reçu sont lues", () => {
  const etats = etatParRecu([
    notification("recent", "REC-9", "2026-10-07T22:10:00Z", "2026-10-07T22:10:00Z"),
    notification("ancien", "REC-9", "2026-10-07T20:00:00Z", "2026-10-07T20:00:00Z"),
  ]);

  expect(etats).toHaveLength(1);
  expect(etats[0]?.id).toBe("recent");
});

it("ne fond pas deux notifications sans reçu, et les trie par date décroissante", () => {
  const etats = etatParRecu([
    notification("a", null, null, "2026-10-07T10:00:00Z"),
    notification("b", null, null, "2026-10-08T10:00:00Z"),
  ]);

  expect(etats.map((n) => n.id)).toEqual(["b", "a"]);
});
