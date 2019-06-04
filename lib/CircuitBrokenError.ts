import * as consts from './consts';
import { TotalStats } from './stats';
import { RawStats } from './utils';

type Totals = RawStats['stats'];

export default class CircuitBrokenError extends Error {
  name: string;

  constructor(name: string, totals: Totals, threshold: number) {
    super();

    let prefix = '';

    if (name) {
      prefix = `[Breaker: ${name}] `;
    }

    this.message = `${prefix}${
      consts.CIRCUIT_OPENED
    } - The percentage of failed requests (${Math.floor((1 - totals.successful / totals.total) * 100)}%) is greater than the threshold specified (${threshold * 100}%)`;
    this.name = name;
  }
}
