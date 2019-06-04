import Promise from 'bluebird';

export type Omit < T , K > = Pick<T, Exclude<keyof T, K>>;

export type PromiseOrCallback < T = unknown > =
  | (() => Promise<T>)
  | ((callback: () => T) => void);
