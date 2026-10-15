/** numeric columns come back from pg as strings; convert them to numbers. */
export const numericToNumber = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
