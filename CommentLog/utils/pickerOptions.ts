import type { TypeOption } from '../types/commentLogTypes';

/** filter selection choices */
export const pickerOptions = (options: TypeOption[]): TypeOption[] =>
  options.filter(option => option.selectable);
