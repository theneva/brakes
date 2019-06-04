import { EventEmitter } from 'events';
import Bucket from './Bucket';

/* Example Default Options */
const defaultOptions = {
  bucketSpan: 1000,
  bucketNum: 60,
  percentiles: [0.0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.995, 1],
  statInterval: 1200
};

type Opts = typeof defaultOptions;

const defaultCumulativeStats = {
  // Total count of requests, failures, etc.
  countTotal: 0,
  countSuccess: 0,
  countFailure: 0,
  countTimeout: 0,
  countShortCircuited: 0,
  // Derivate in between two measurements to support counters that only increase (e.g., prom-client)
  countTotalDeriv: 0,
  countSuccessDeriv: 0,
  countFailureDeriv: 0,
  countTimeoutDeriv: 0,
  countShortCircuitedDeriv: 0
};

export type CumulativeStats = typeof defaultCumulativeStats;

export type Percentiles = Record<string, number>;
export type TotalStats = CumulativeStats & {
  percentiles: Percentiles;
  latencyMean: number;
};

export default class Stats extends EventEmitter {
  private _opts: Opts;
  private _activePosition: number;
  private _cumulative: CumulativeStats;
  private _buckets: Bucket[];
  private _activeBucket: Bucket;

  _totals: TotalStats;

  private _spinningInterval: ReturnType<typeof setInterval>;
  private _snapshotInterval: ReturnType<typeof setInterval>;

  constructor(opts: Partial<Opts>) {
    super();
    this._opts = Object.assign({}, defaultOptions, opts);
    this._activePosition = this._opts.bucketNum - 1;

    // initialize buckets
    this._buckets = [];
    for (let i = 0; i < this._opts.bucketNum; i++) {
      this._buckets.push(new Bucket(this._cumulative));
    }

    this._activeBucket = this._buckets[this._activePosition];
    this._startBucketSpinning();
    this._totals = this._generateStats(this._buckets, true);
  }

  getCumulativeStatistics() {
    return this._cumulative;
  }

  reset() {
    for (let i = 0; i < this._opts.bucketNum; i++) {
      this._shiftAndPush(this._buckets, new Bucket(this._cumulative));
    }
    this._activeBucket = this._buckets[this._activePosition];
    this._update();
  }

  /* Starts cycling through buckets */
  _startBucketSpinning() {
    this._spinningInterval = setInterval(() => {
      this._shiftAndPush(this._buckets, new Bucket(this._cumulative));
      this._activeBucket = this._buckets[this._activePosition];
    }, this._opts.bucketSpan);
    this._spinningInterval.unref();
  }

  /* Stop Bucket from spinning */
  _stopBucketSpinning() {
    if (this._spinningInterval) {
      clearInterval(this._spinningInterval);
      this._spinningInterval = undefined;
      return true;
    }
    return false;
  }

  /* start generating snapshots */
  startSnapshots(interval?: number) {
    this._snapshotInterval = setInterval(
      () => {
        this._snapshot();
      },
      // TODO: This falls back to this._opts.statInterval if interval is 0
      interval || this._opts.statInterval
    );
    this._snapshotInterval.unref();
  }

  /* stop generating snapshots */
  stopSnapshots() {
    if (this._snapshotInterval) {
      clearInterval(this._snapshotInterval);
      this._snapshotInterval = undefined;
      return true;
    }
    return false;
  }

  /*
  Generate new totals
  `includeLatencyStats` flag determines whether or not to calculate a new round of
  percentiles. If `includeLatencyStats` is set to false or undefined, the existing
  calculated percentiles will be preserved.
  */
  _generateStats(buckets: Bucket[], includeLatencyStats?: boolean) {
    // reduce buckets
    const tempTotals = buckets.reduce(
      (prev, cur) => {
        if (!cur) return prev;

        // aggregate incremented stats
        prev.total += cur.total || 0;
        prev.failed += cur.failed || 0;
        prev.timedOut += cur.timedOut || 0;
        prev.successful += cur.successful || 0;
        prev.shortCircuited += cur.shortCircuited || 0;

        // concat `requestTimes` Arrays
        if (includeLatencyStats) {
          prev.requestTimes.push.apply(
            prev.requestTimes,
            cur.requestTimes || []
          );
        }
        return prev;
      },
      {
        failed: 0,
        timedOut: 0,
        total: 0,
        shortCircuited: 0,
        latencyMean: 0,
        successful: 0,
        requestTimes: [],
        percentiles: {} as Percentiles
      }
    );

    // calculate percentiles
    if (includeLatencyStats) {
      tempTotals.requestTimes.sort((a, b) => a - b);
      tempTotals.latencyMean =
        this._calculateMean(tempTotals.requestTimes) || 0;
      this._opts.percentiles.forEach(p => {
        tempTotals.percentiles[p] =
          this._calculatePercentile(p, tempTotals.requestTimes) || 0;
      });
    }
    else {
      // pass through previous percentile and mean
      tempTotals.latencyMean = this._totals.latencyMean;
      tempTotals.percentiles = this._totals.percentiles;
    }

    // remove large totals Arrays
    delete tempTotals.requestTimes;
    this._totals = Object.assign(tempTotals, this._cumulative);

    return this._totals;
  }

  _resetDerivs() {
    this._cumulative.countTotalDeriv = 0;
    this._cumulative.countSuccessDeriv = 0;
    this._cumulative.countFailureDeriv = 0;
    this._cumulative.countTimeoutDeriv = 0;
    this._cumulative.countShortCircuitedDeriv = 0;
  }

  /*
  Calculate percentile.
  This function assumes the list you are giving it is already ordered.
  */
  _calculatePercentile(percentile: number, array: number[]) {
    if (percentile === 0) {
      return array[0];
    }
    const idx = Math.ceil(percentile * array.length);
    return array[idx - 1];
  }

  /*
  Calculate mean.
  */
  _calculateMean(array: number[]) {
    const sum = array.reduce((a, b) => a + b, 0);
    return Math.round(sum / array.length);
  }

  /* Update totals and send updated event */
  _update() {
    this.emit('update', this._generateStats(this._buckets));
  }

  _shiftAndPush<T>(arr: T[], item: T) {
    arr.push(item);
    arr.shift();
    return arr;
  }

  /* Send snapshot stats event */
  _snapshot() {
    this.emit('snapshot', this._generateStats(this._buckets, true));
    this._resetDerivs();
  }

  /* Register a failure */
  failure(runTime: number) {
    this._activeBucket.failure(runTime);
    this._update();
  }

  /* Register a success */
  success(runTime: number) {
    this._activeBucket.success(runTime);
    this._update();
  }

  /* Register a short circuit */
  shortCircuit() {
    this._activeBucket.shortCircuit();
    this._update();
  }

  /* Register a timeout */
  timeout(runTime: number) {
    this._activeBucket.timeout(runTime);
    this._update();
  }
}
