/** Réglage numérique d'un calque : clé, libellé, bornes. */
export interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export const P = (
  key: string,
  min: number,
  max: number,
  unit?: string,
  step?: number,
  label = `param.${key}`,
): Param => ({
  key,
  label,
  min,
  max,
  unit,
  step,
});
