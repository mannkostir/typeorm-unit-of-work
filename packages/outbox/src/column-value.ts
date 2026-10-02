export const maxColumnCharacters = 255;

export function fitsColumn(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && [...value].length <= maxColumnCharacters;
}
