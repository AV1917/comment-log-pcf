export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

export const normaliseGuid = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const id = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase()
    : undefined;
};

export const requireGuid = (value: unknown, description: string): string => {
  const id = normaliseGuid(value);
  if (!id) throw new Error(`${description} is not a valid record ID.`);
  return id;
};

export const normaliseColour = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : undefined;
};

export const optionValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return 'An unexpected error occurred.';
};
