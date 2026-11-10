/**
 * The approved chunk each C201 book question was written from (read and verified by hand before the question was kept).
 * generate-oracles.mjs re-reads each chunk from the database and checks that it holds every fact of its question; it records
 * the source, section and page marker in the private oracle. Nothing here is given to the application under test.
 * Twin chunks (the corpus holds some passages twice) are found by text and accepted too.
 */
export const BOOK_SOURCES = {
  V156: "dsm5-5d435548", V157: "dsm5-41d988e6", V158: "dsm5-101be83f", V159: "dsm5-7311e944", V160: "dsm5-c0f782ca",
  V161: "dsm5-d05ff18c", V162: "dsm5-d6eca14e", V163: "dsm5-1c955d5a", V164: "dsm5-729b1347", V165: "dsm5-17885f5a",
  V166: "dsm5-42db2fde", V167: "dsm5-c0829a48", V168: "dsm5-c8b9ceed", V169: "dsm5-75ca65b9",
  V170: "taylor-2bf4023d", V171: "taylor-3af44e2a", V172: "taylor-6884187d", V173: "taylor-9cc86682", V174: "taylor-5a55bd22",
  V175: "taylor-469159cf", V176: "taylor-90b964c5", V177: "taylor-d095e73b", V178: "taylor-e171c60f", V179: "taylor-d1b07ab9",
  V180: "taylor-dc04e553",
  V181: "stahl-5435b8c15ae8", V182: "stahl-3eff9313f4d0", V183: "stahl-ac04f8605288", V184: "stahl-f687492e4f81", V185: "stahl-47e041e6f098",
  V186: "stahl-74e6d09293c9", V187: "stahl-41a2ecb24ad4", V188: "stahl-1f468a99f973", V189: "stahl-e3a5b83e0d9a", V190: "stahl-ed5e2c9e2972",
};
