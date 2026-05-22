// Curated categorical palette — distinct and harmonious, not random RGB.
export const PALETTE = [
  '#2f6df0', '#e5544b', '#1f9d6b', '#b9770e',
  '#8e5bd6', '#0e9bb9', '#d64f8e', '#6b8e23',
  '#d98324', '#3a6ea5', '#9d2f5a', '#4c7a34',
];

export function clusterColor(i) {
  return PALETTE[i % PALETTE.length];
}
