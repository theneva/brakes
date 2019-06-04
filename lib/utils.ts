import Promise from 'bluebird';
import { PromiseOrCallback } from './types';
import { Percentiles } from './stats';

export const callbacks = ['cb', 'callback', 'callback_', 'done'];

export function hasCallback(fn: Function) {
  const args = getFnArgs(fn);
  const callbackCandidate = args[args.length - 1];
  return callbacks.indexOf(callbackCandidate) > -1;
}

export function promisifyIfFunction<T>(
  fn: PromiseOrCallback<T>,
  isPromise: boolean,
  isFunction: boolean
): () => Promise<T> {
  if (isPromise) {
    // @ts-ignore we trust the caller
    return fn;
  }

  if (isFunction || hasCallback(fn)) {
    // @ts-ignore we trust the caller
    return Promise.promisify(fn);
  }

  // @ts-ignore we trust the caller
  return fn;
}

/*
 * Return a list arguments for a function
 */
export function getFnArgs(fn: Function) {
  const match = fn.toString().match(/^[function\s]?.*?\(([^)]*)\)/);
  let args = '';
  if (!match) {
    const matchSingleArg = fn.toString().match(/^([^)]*) =>/);
    if (matchSingleArg) {
      args = matchSingleArg[1];
    }
  }
  else {
    args = match[1];
  }

  // Split the arguments string into an array comma delimited.
  return args
    .split(', ')
    .map(arg => arg.replace(/\/\*.*\*\//, '').trim())
    .filter(arg => arg);
}

export type RawStats = {
  stats: {
    total: number;
    successful: number;
    failed: number;
    shortCircuited: number;
    timedOut: number;
    latencyMean: number;
    percentiles: Percentiles;

    countTotal: number;
    countSuccess: number;
    countFailure: number;
    countTimeout: number;
    countShortCircuited: number;

    countTotalDeriv: number;
    countSuccessDeriv: number;
    countFailureDeriv: number;
    countTimeoutDeriv: number;
    countShortCircuitedDeriv: number;
  };
  name: string;
  group: string;
  time: number;
  open: boolean;
  waitThreshold: number;
  circuitDuration: number;
  threshold: number;
};

/*
 * Map a brakes stats object to a hystrix stats object
 */
export function mapToHystrixJson(rawStats: RawStats) {
  const stats = rawStats.stats;
  return {
    type: 'HystrixCommand',
    name: rawStats.name,
    group: rawStats.group,
    currentTime: rawStats.time,
    isCircuitBreakerOpen: rawStats.open,
    errorPercentage: stats.total
      ? Math.round((1 - stats.successful / stats.total) * 100)
      : 0,
    errorCount: stats.failed,
    requestCount: stats.total,
    rollingCountBadRequests: 0, // not reported
    rollingCountCollapsedRequests: 0, // not reported
    rollingCountExceptionsThrown: 0, // not reported
    rollingCountFailure: stats.failed,
    rollingCountFallbackFailure: 0, // not reported
    rollingCountFallbackRejection: 0, // not reported
    rollingCountFallbackSuccess: 0, // not reported
    rollingCountResponsesFromCache: 0, // not reported
    rollingCountSemaphoreRejected: 0, // not reported
    rollingCountShortCircuited: stats.shortCircuited, // not reported
    rollingCountSuccess: stats.successful,
    rollingCountThreadPoolRejected: 0, // not reported
    rollingCountTimeout: stats.timedOut,
    currentConcurrentExecutionCount: 0, // not reported
    latencyExecute_mean: stats.latencyMean,
    latencyExecute: {
      0: stats.percentiles['0'],
      25: stats.percentiles['0.25'],
      50: stats.percentiles['0.5'],
      75: stats.percentiles['0.75'],
      90: stats.percentiles['0.9'],
      95: stats.percentiles['0.95'],
      99: stats.percentiles['0.99'],
      99.5: stats.percentiles['0.995'],
      100: stats.percentiles['1']
    },
    latencyTotal_mean: 15,
    latencyTotal: {
      0: stats.percentiles['0'],
      25: stats.percentiles['0.25'],
      50: stats.percentiles['0.5'],
      75: stats.percentiles['0.75'],
      90: stats.percentiles['0.9'],
      95: stats.percentiles['0.95'],
      99: stats.percentiles['0.99'],
      99.5: stats.percentiles['0.995'],
      100: stats.percentiles['1']
    },
    propertyValue_circuitBreakerRequestVolumeThreshold: rawStats.waitThreshold,
    propertyValue_circuitBreakerSleepWindowInMilliseconds:
      rawStats.circuitDuration,
    propertyValue_circuitBreakerErrorThresholdPercentage: rawStats.threshold,
    propertyValue_circuitBreakerForceOpen: false, // not reported
    propertyValue_circuitBreakerForceClosed: false, // not reported
    propertyValue_circuitBreakerEnabled: true, // not reported
    propertyValue_executionIsolationStrategy: 'THREAD', // not reported
    propertyValue_executionIsolationThreadTimeoutInMilliseconds: 800, // not reported
    propertyValue_executionIsolationThreadInterruptOnTimeout: true, // not reported
    // @ts-ignore I have no idea what this is
    propertyValue_executionIsolationThreadPoolKeyOverride: null, // not reported
    propertyValue_executionIsolationSemaphoreMaxConcurrentRequests: 20, //  not reported
    propertyValue_fallbackIsolationSemaphoreMaxConcurrentRequests: 10, //  not reported
    propertyValue_metricsRollingStatisticalWindowInMilliseconds: 10000, //  not reported
    propertyValue_requestCacheEnabled: false, // not reported
    propertyValue_requestLogEnabled: false, // not reported
    reportingHosts: 1, // not reported

    countTotal: stats.countTotal,
    countSuccess: stats.countSuccess,
    countFailure: stats.countFailure,
    countTimeout: stats.countTimeout,
    countShortCircuited: stats.countShortCircuited,

    countTotalDeriv: stats.countTotalDeriv,
    countSuccessDeriv: stats.countSuccessDeriv,
    countFailureDeriv: stats.countFailureDeriv,
    countTimeoutDeriv: stats.countTimeoutDeriv,
    countShortCircuitedDeriv: stats.countShortCircuitedDeriv
  };
}
