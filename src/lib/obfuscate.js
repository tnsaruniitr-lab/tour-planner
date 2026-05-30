// Partially mask a person's name for the demo / privacy. The first three
// letters of each name word become "xxx"; the rest is kept so tours and
// patients stay distinguishable.
//   "Özen Atas, Ayten" -> "xxxn xxxs, xxxen"
//   "Celik, Hülya"     -> "xxxik, xxxya"
// Flip MASK_NAMES back to true to re-enable masking. (The bundled CSVs already
// contain the real names, so masking only ever affected the on-screen display.)
const MASK_NAMES = false;

export function obfuscateName(name) {
  if (!name || !MASK_NAMES) return name;
  return String(name).replace(/\p{L}+/gu, (word) => 'xxx' + word.slice(3));
}
