/**
 * The approved chunk each C202 book question was written from (read and verified by hand before the question was kept).
 * generate-oracles.mjs re-reads each chunk from the database and checks that it holds every fact of its question; it records
 * the source, section and page marker in the private oracle. Nothing here is given to the application under test.
 */
export const BOOK_SOURCES = {
  W156: "dsm5-5dc1d234", W157: "dsm5-9db94ad6", W158: "dsm5-27cfd8c6", W159: "dsm5-f599386a", W160: "dsm5-9fcd5f39",
  W161: "dsm5-42093ef6", W162: "dsm5-da31cdb0", W163: "dsm5-399be592", W164: "dsm5-d10639e8", W165: "dsm5-a3453872",
  W166: "dsm5-2fa6f04e", W167: "dsm5-af932542", W168: "dsm5-936bd4c0",
  W169: "taylor-f481954b", W170: "taylor-b2b30f8a", W171: "taylor-463b16d6", W172: "taylor-c6509034", W173: "taylor-bd8117ca",
  W174: "taylor-b0a63ac3", W175: "taylor-df72fba5", W176: "taylor-39b39c94", W177: "taylor-725517b4", W178: "taylor-e79a2cc1",
  W179: "taylor-819dc882",
  W180: "stahl-565b80c0441e", W181: "stahl-1ceb576867c6", W182: "stahl-55617d5b4900", W183: "stahl-01270850d383", W184: "stahl-90299966a586",
  W185: "stahl-d45301aafe57", W186: "stahl-330c19965e8b", W187: "stahl-672584b27554", W188: "stahl-667320fd69c6", W189: "stahl-80bca05d99dc",
  W190: "stahl-18712cdf41c1",
};
