// Partially mask a person's name for the demo / privacy. The first three
// letters of each name word become "xxx"; the rest is kept so tours and
// patients stay distinguishable.
//   "Özen Atas, Ayten" -> "xxxn xxxs, xxxen"
//   "Celik, Hülya"     -> "xxxik, xxxya"
export function obfuscateName(name) {
  if (!name) return name;
  return String(name).replace(/\p{L}+/gu, (word) => 'xxx' + word.slice(3));
}
