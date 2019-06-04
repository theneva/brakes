import { CumulativeStats } from './Stats';
import * as consts from './consts';

export default class Bucket {
  failed = 0;
  successful = 0;
  total = 0;
  shortCircuited = 0;
  timedOut = 0;
  requestTimes: number[] = [];
  private cumulativeStats: CumulativeStats;

  constructor(cumulativeStats: CumulativeStats) {
    this.cumulativeStats = cumulativeStats;
  }

  /* Calculate % of a given field */
  percent(field: string) {
    if (!Object(this).hasOwnProperty(field)) {
      throw new Error(consts.INVALID_BUCKET_PROP);
    }

    if (!this.total) {
      return 0;
    }

    // @ts-ignore this is unchanged
    const found = this[field] as number;
    return found / this.total;
  }

  /* Register a failure */
  failure(runTime: number) {
    this.total++;
    this.cumulativeStats.countTotal++;
    this.cumulativeStats.countTotalDeriv++;
    this.failed++;
    this.cumulativeStats.countFailure++;
    this.cumulativeStats.countFailureDeriv++;
    this.requestTimes.push(runTime);
  }

  /* Register a success */
  success(runTime: number) {
    this.total++;
    this.cumulativeStats.countTotal++;
    this.cumulativeStats.countTotalDeriv++;
    this.successful++;
    this.cumulativeStats.countSuccess++;
    this.cumulativeStats.countSuccessDeriv++;
    this.requestTimes.push(runTime);
  }

  /* Register a short circuit */
  shortCircuit() {
    this.shortCircuited++;
    this.cumulativeStats.countShortCircuited++;
    this.cumulativeStats.countShortCircuitedDeriv++;
  }

  /* Register a timeout */
  timeout(runTime: number) {
    this.total++;
    this.cumulativeStats.countTotal++;
    this.cumulativeStats.countTotalDeriv++;
    this.timedOut++;
    this.cumulativeStats.countTimeout++;
    this.cumulativeStats.countTimeoutDeriv++;
    this.requestTimes.push(runTime);
  }
}
