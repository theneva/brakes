import { EventEmitter } from 'events';
import Promise from 'bluebird';
import Stats, { TotalStats } from './stats';
import { promisifyIfFunction, RawStats } from './utils';
import instance from './globalStats';
import * as consts from './consts';
import Circuit from './Circuit';
import { PromiseOrCallback } from './types';

export type ConfigurationOptions < T > = {
  // string to use for name of circuit. This is mostly used for reporting on stats.
  name: string;
  // string to use for group of circuit. This is mostly used for reporting on stats.
  group: string;
  // time in ms that a specific bucket should remain active
  bucketSpan: number;
  // interval in ms that brakes should emit a snapshot event
  statInterval: number;
  // array<number> that defines the percentile levels that should be calculated on the stats object (i.e. 0.9 for 90th percentile)
  percentiles?: number[];
  // # of buckets to retain in a rolling window
  bucketNum: number;
  // time in ms that a circuit should remain broken
  circuitDuration: number;
  // number of requests to wait before testing circuit health
  waitThreshold: number;
  // % threshold for successful calls. If the % of successful calls dips below this threshold the circuit will break
  threshold: number;
  // time in ms before a service call will timeout
  timeout: number;
  // function that returns true if an error should be considered a failure (receives the error object returned by your command.) This allows for non-critical errors to be ignored by the circuit breaker
  isFailure?(err: Error): boolean;
  // time in ms interval between each execution of health check function
  healthCheckInterval: number;
  // modifies the error message by adding circuit name. default is true.
  modifyError: boolean;
  // boolean to opt out of registering global
  // TODO: find a better description of what this does
  registerGlobal?: boolean;
  // boolean to opt out of check for callback in function. This affects the passed in function, health check and fallback
  isPromise: false;
  // boolean to opt out of check for callback, always promisifying in function. This affects the passed in function, health check and fallback
  isFunction: boolean;
  // function to call for the health check (can be defined also with calling healthCheck function)
  healthCheck?: PromiseOrCallback;
  // function to call for fallback (can be defined also with calling fallback function)
  fallback?(): PromiseOrCallback<T>;
};

const defaultOptions: ConfigurationOptions<unknown> = {
  bucketSpan: 1000,
  bucketNum: 60,
  name: 'defaultBrake',
  group: 'defaultBrakeGroup',
  circuitDuration: 30000,
  statInterval: 1200,
  registerGlobal: true,
  waitThreshold: 100,
  threshold: 0.5,
  timeout: 15000,
  healthCheckInterval: 5000,
  healthCheck: undefined,
  fallback: undefined,
  isFunction: false,
  isPromise: false,
  modifyError: true
};

export default class Brakes<T> extends EventEmitter {
  _circuitOpen = false;
  _opts: ConfigurationOptions<T>;
  _stats: Stats;
  _circuitGeneration: number;

  _fallback: () => Promise<T>;
  _healthCheck: () => Promise<any>;
  _healthInterval: ReturnType<typeof setInterval> | null;

  _masterCircuit: Circuit<T>;

  name: string;
  group: string;

  constructor(func: PromiseOrCallback<T>, opts: ConfigurationOptions<T>) {
    super();

    if (typeof func === 'object' && !opts) {
      opts = func;
      func = undefined;
    }

    this._opts = Object.assign({}, defaultOptions, opts);
    this._stats = new Stats(opts);

    this._circuitGeneration = 1;

    this.name = this._opts.name;
    this.group = this._opts.group;

    this._attachListeners();
    this._stats.startSnapshots();

    // register with global stats collector
    if (this._opts.registerGlobal) {
      instance.register(this);
    }

    const isPromise = this._opts.isPromise;
    const isFunction = this._opts.isFunction;

    // check if health check is in options
    if (this._opts.healthCheck) {
      this.healthCheck(this._opts.healthCheck, isPromise, isFunction);
    }

    // create a master circuit
    if (func) {
      this._masterCircuit = new Circuit<T>(this, func, opts);
    }

    // check if fallback is in options
    if (this._opts.fallback) {
      this.fallback(this._opts.fallback, isPromise, isFunction);
    }
  }

  /* Static method to get access to global stats */
  static getGlobalStats() {
    return instance;
  }

  /* Instance method to get access to global stats */
  getGlobalStats() {
    return instance;
  }

  /*
  Perform all logic to allow proper garbage collection
  */
  destroy() {
    instance.deregister(this);
    // the line below won't be needed with Node6, it provides
    // a method 'eventNames()'
    // @ts-ignore
    const eventNames = Object.keys(this._events);
    eventNames.forEach(event => {
      this.removeAllListeners(event);
    });
  }

  exec() {
    if (this._masterCircuit) {
      return this._masterCircuit.exec.apply(this._masterCircuit, arguments);
    }
    return Promise.reject(new Error(consts.NO_FUNCTION));
  }

  _close() {
    this._circuitOpen = false;
    this.emit('circuitClosed');
  }

  _open() {
    if (this._circuitOpen) return;
    this.emit('circuitOpen');
    this._circuitOpen = true;
    this._circuitGeneration++;
    if (this._healthCheck) {
      this._setHealthInterval();
    }
    else {
      this._resetCircuitTimeout();
    }
  }

  _setHealthInterval() {
    if (this._healthInterval) return;
    this._healthInterval = setInterval(() => {
      if (this._circuitOpen) {
        this._healthCheck()
          .then(() => {
            // it is possible that in the meantime, the circuit is already
            // closed by the previous health check
            if (this._circuitOpen) {
              this._stats.reset();
              this._close();
            }
            if (this._healthInterval != null) {
              clearInterval(this._healthInterval);
              this._healthInterval = null;
            }
          })
          .catch((err: unknown) => {
            this.emit('healthCheckFailed', err);
          });
      }
      else {
        // the circuit is closed out of health check,
        // or from one of the cascading health checks
        // (if the interval is not long enough to wait for one
        // health check to complete, the previous health check might
        // close the circuit) OR (manually closed).
        if (this._healthInterval != null) {
          clearInterval(this._healthInterval);
          this._healthInterval = null;
        }
      }
    }, this._opts.healthCheckInterval);
    this._healthInterval.unref();
  }

  _resetCircuitTimeout() {
    const timer = setTimeout(() => {
      this._stats.reset();
      this._close();
    }, this._opts.circuitDuration);
    timer.unref();
  }

  /*
  Allow user to pass a function to be used as a health check,
  to close the circuit if the function succeeds.
   */
  healthCheck(
    func: PromiseOrCallback<void>,
    isPromise: boolean,
    isFunction: boolean
  ) {
    this._healthCheck = promisifyIfFunction(func, isPromise, isFunction);
  }

  /*
  Allow user to pass function to be used as a fallback
  */
  fallback(
    func: PromiseOrCallback<T>,
    isPromise: boolean,
    isFunction: boolean
  ) {
    if (this._masterCircuit) {
      this._fallback = this._masterCircuit.fallback(
        func,
        isPromise,
        isFunction
      );
    }
    else {
      this._fallback = promisifyIfFunction(func, isPromise, isFunction);
    }
  }

  /*
  Listen to certain events and execute logic
  This is mostly used for stats monitoring
  */
  _attachListeners() {
    this.on('success', d => {
      this._successHandler(d);
    });
    this.on('timeout', (d, error, execGeneration) => {
      this._timeoutHandler(d, execGeneration);
    });
    this.on('failure', (d, error, execGeneration) => {
      this._failureHandler(d, execGeneration);
    });
    this._stats.on('update', (d: TotalStats) => {
      this._checkStats(d);
    });
    this._stats.on('snapshot', (d: TotalStats) => {
      this._snapshotHandler(d);
    });
  }

  /*
  Calculate stats and set internal state based on threshold
  */
  _checkStats(stats: TotalStats) {
    const pastThreshold = (stats.total || 0) > this._opts.waitThreshold;
    if (!pastThreshold || !stats.total || this._circuitOpen) return;
    if (stats.successful / stats.total < this._opts.threshold) {
      this._open();
    }
  }

  isOpen() {
    return this._circuitOpen;
  }

  _snapshotHandler(stats: Stats) {
    // attach stats metaData for easier downstream consumption
    this.emit('snapshot', {
      name: this.name,
      group: this.group,
      time: Date.now(),
      open: this._circuitOpen,
      circuitDuration: this._opts.circuitDuration,
      threshold: this._opts.threshold,
      waitThreshold: this._opts.waitThreshold,
      stats
    });
  }

  _successHandler(runTime: number) {
    this._stats.success(runTime);
  }

  _timeoutHandler(runTime: number, execGeneration: number) {
    if (execGeneration === this._circuitGeneration) {
      this._stats.timeout(runTime);
    }
  }

  _failureHandler(runTime: number, execGeneration: number) {
    if (execGeneration === this._circuitGeneration) {
      this._stats.failure(runTime);
    }
  }

  slaveCircuit(
    service: PromiseOrCallback<T>,
    fallback: PromiseOrCallback<T>,
    options: ConfigurationOptions<T>
  ): Circuit<T> {
    return new Circuit(this, service, fallback, options);
  }
}
