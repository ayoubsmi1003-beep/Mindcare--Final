/**
 * The approved chunk each C270 book turn was written from (read in the evaluation database before the question was kept).
 * A string = the chunk of a one-turn case; an array = one chunk per turn of a conversation.
 * generate-oracles.mjs re-reads each chunk and checks it still holds every fact of its turn. Nothing here reaches the application.
 */
export const BOOK_SOURCES = {
  // DSM-5 (fr)
  L001: "dsm5-3bd9557a", L002: "dsm5-8af34a3c", L003: "dsm5-a9d5dfbe", L004: "dsm5-b6a1dcfa", L005: "dsm5-b0fac3ec",
  L006: "dsm5-817f5878", L007: "dsm5-aba4e3db", L008: "dsm5-1f7ebda0", L009: "dsm5-58df93bc", L010: "dsm5-bea480b2",
  L011: "dsm5-94065d29", L012: "dsm5-b2aab9c2", L013: "dsm5-2ae6fa57", L014: "dsm5-6cf3f24b", L015: "dsm5-a1ffbb16",
  L016: "dsm5-0c3677df", L017: "dsm5-e2f21948", L018: "dsm5-c1e00d3e", L019: "dsm5-bbdb075b", L020: "dsm5-f21affa3",
  L021: "dsm5-d6e007b0", L022: "dsm5-e71bb8c1", L023: "dsm5-8072e3da", L024: "dsm5-f9166f05", L025: "dsm5-372ea063",
  L026: "dsm5-d211b860", L027: "dsm5-37645e15", L028: "dsm5-581e7e97", L029: "dsm5-a16a9b93", L030: "dsm5-cc5cb212",
  // Stahl (en)
  L031: "stahl-01049f308fdf", L032: "stahl-66eae98c09a2", L033: "stahl-fc22e8960090", L034: "stahl-b90c4d8d85e9", L035: "stahl-044688f6a7cc",
  L036: "stahl-47a01b540130", L037: "stahl-0abac5dddf7a", L038: "stahl-2d3d5af795c8", L039: "stahl-ba3bcfc456cb", L040: "stahl-652301427a7c",
  L041: "stahl-ab7fdd20a78b", L042: "stahl-c58850c6d5da", L043: "stahl-eb61a4eb41d3", L044: "stahl-8458473ba05c", L045: "stahl-f1322c513179",
  L046: "stahl-a4506a66844d", L047: "stahl-5c4228d143fa", L048: "stahl-baf6af5267da", L049: "stahl-288ccb702804", L050: "stahl-4bd3cc656877",
  L051: "stahl-013c6a47e934", L052: "stahl-34703900f91f", L053: "stahl-f1e59c56c101", L054: "stahl-074bb4ce6c2f", L055: "stahl-d0df16e0fb94",
  // Maudsley (en)
  L056: ["taylor-a4e5e19d", "taylor-f9155601"], L057: "taylor-00144235", L058: "taylor-da4c0d4f", L059: "taylor-93f0d9ef", L060: "taylor-86b094e0",
  L061: "taylor-0190f40c", L062: "taylor-dfa6ba87", L063: "taylor-cc2eff0d", L064: "taylor-cff07b08", L065: "taylor-8e584180",
  L066: "taylor-dbfa9ad5", L067: "taylor-dfac10b6", L068: "taylor-a1083437", L069: "taylor-2dd357ce", L070: "taylor-a3d7ba97",
  L071: "taylor-8891e3e6", L072: "taylor-4b8a415b", L073: "taylor-8f3b68d3", L074: "taylor-873da7a9", L075: "taylor-30354590",
  L076: "taylor-3ea1e34f", L077: "taylor-09ad180e", L078: "taylor-d9698558", L079: "taylor-bd8f5cec",
  // context conversation X005: one book turn between two record turns
  X005: [null, "stahl-ee1744aeba7e", null],
};
