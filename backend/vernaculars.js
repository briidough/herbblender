// Shared filter for GBIF vernacular-name lists, used by both the manager's
// /api/gbif/common-names endpoint and the seed importer, so the names offered in the UI are
// exactly the names the seed writes.

// Two vernacular names are "the same name" if they differ only in punctuation, spacing,
// diacritics or case. GBIF genuinely returns all of these variants for the same taxon —
// "Devil's Bush" / "Devil’s bush" (ASCII vs typographic apostrophe), "Spear Mint" /
// "Spearmint", "Lemonbalm" / "lemon balm". Lowercasing alone, which is all the original
// filter did, catches none of them.
function dedupeKey(name) {
  return name
    .normalize('NFKD')            // split accented letters into base + combining mark
    .replace(/[^a-zA-Z0-9]/g, '') // drop the marks along with spaces, dots and every quote style
    .toLowerCase();
}

// Within a group of variants, prefer the spaced form — it is the more readable rendering in a
// chip list, and "lemon balm" beats "Lemonbalm". Ties go to the more capitalised variant,
// which is usually the deliberately-typed one rather than a bulk-imported lowercase entry,
// then to plain ASCII ("Yerba Mate" over "Yerba Maté"), and finally to lexicographic order.
// Casing is never changed, only chosen, so the winner stays verbatim GBIF text.
//
// The last two rules exist so the result does not depend on the order GBIF happened to return
// the names in — without them a re-run could silently flip a name and produce a spurious diff.
function preferred(a, b) {
  const rank = [
    s => -(s.match(/\s/g) || []).length,        // more spaces wins
    s => -(s.match(/[A-Z]/g) || []).length,     // more capitals wins
    s => (s.match(/[^\x20-\x7E]/g) || []).length, // fewer non-ASCII wins
  ];
  for (const score of rank) {
    if (score(a) !== score(b)) return score(a) < score(b) ? a : b;
  }
  return a <= b ? a : b;
}

function englishVernaculars(results) {
  const chosen = new Map();
  for (const n of results || []) {
    if (n.language !== 'eng' || !n.vernacularName) continue;
    const name = n.vernacularName.trim();
    if (!name || name.includes('-')) continue;
    const key = dedupeKey(name);
    if (!key) continue;
    const existing = chosen.get(key);
    chosen.set(key, existing ? preferred(existing, name) : name);
  }
  return [...chosen.values()];
}

module.exports = { englishVernaculars, dedupeKey, preferred };
