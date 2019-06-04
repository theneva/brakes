import { EventEmitter } from 'events';
import Promise from 'bluebird';
import Brakes, { ConfigurationOptions } from './Brakes';
import { promisifyIfFunction } from './utils';
import TimeOutError from './TimeOutError';
import CircuitBrokenError from './CircuitBrokenError';
import * as consts from './consts';
import { PromiseOrCallback } from './types';

const defaultOptions = {
  isFailure: () => true
};

/**
 * Class that can sit on top of a Brakes. It's basically just a pair of primary and fallback Promises you can put on
 * top of a Brake that monitors a common Service (eg: ).
 */
export default class Circuit<T> extends EventEmitter {
  private _brakes: Brakes<T>;
  private _serviceCall: () => Promise<T>;
  private _fallback: () => Promise<T>;
  private _opts: ConfigurationOptions<T>;

  constructor(
    brakes: Brakes<T>,
    main: PromiseOrCallback<T>,
    fallback: PromiseOrCallback<T>,
    options: ConfigurationOptions<T>
  ) {
    super();

    if (!(brakes instanceof EventEmitter)) {
      throw new Error(consts.NO_BRAKES);
    }
    this._brakes = brakes;

    if (!main || typeof main !== 'function') {
      throw new Error(consts.NO_FUNCTION);
    }
    else if (fallback) {
      if (typeof fallback !== 'function') {
        if (options) {
          throw new Error(consts.NO_FUNCTION);
        }
        options = fallback;
        fallback = undefined;
      }
    }
    this._opts = Object.assign({}, defaultOptions, options);

    this._serviceCall = promisifyIfFunction(
      main,
      this._opts.isPromise,
      this._opts.isFunction
    );

    if (fallback) {
      this.fallback(fallback, this._opts.isPromise, this._opts.isFunction);
    }
  }

  exec(...args: unknown[]) {
    this._brakes.emit('exec');

    // Save circuit generation to scope so we can compare it
    // to the current generation when a request fails.
    // This prevents failures from bleeding between circuit generations.
    const execGeneration = this._brakes._circuitGeneration;

    if (this._brakes._circuitOpen) {
      this._brakes._stats.shortCircuit();
      if (this._fallback) {
        return this._fallback.apply(this, arguments);
      }
      else if (this._brakes._fallback) {
        return this._brakes._fallback.apply(this, arguments);
      }
      return Promise.reject(new CircuitBrokenError(
        this._brakes.name,
        this._brakes._stats._totals,
        this._brakes._opts.threshold
      ));
    }

    const startTime = Date.now();

    // we use _execPromise() wrapper on the service call promise
    // to allow us to more easily hook in stats reporting
    return this._execPromise
      .apply(this, arguments)
      .tap(() => this._brakes.emit('success', Date.now() - startTime))
      .catch((err: Error) => {
        const endTime = Date.now() - startTime;

        // trigger hook listeners
        if (err instanceof TimeOutError) {
          this._brakes.emit('timeout', endTime, err, execGeneration);
        }
        else if (this._opts.isFailure(err)) {
          this._brakes.emit('failure', endTime, err, execGeneration);
        }
        // if fallback exists, call it upon failure
        // there are no listeners or stats collection for
        // the fallback function. The function is fire-and-forget
        // as far as `Brakes` is concerned
        if (this._fallback) {
          return this._fallback.apply(this, args);
        }
        else if (this._brakes._fallback) {
          return this._brakes._fallback.apply(this, args);
        }

        if (
          err.message &&
          this._brakes.name &&
          this._brakes._opts.modifyError
        ) {
          err.message = `[Breaker: ${this._brakes.name}] ${err.message}`;
        }

        return Promise.reject(err);
      });
  }

  /*
   Execute main service call
   */
  _execPromise(...args: unknown[]) {
    return new Promise((resolve, reject) => {
      // start timeout timer
      const timeoutTimer = setTimeout(() => {
        reject(new TimeOutError(consts.TIMEOUT));
      }, this._opts.timeout || this._brakes._opts.timeout);

      this._serviceCall
        .apply(this, args)
        .then((result: T) => {
          clearTimeout(timeoutTimer);
          resolve(result);
        })
        .catch((err: Error) => {
          clearTimeout(timeoutTimer);
          reject(err);
        });

      timeoutTimer.unref();
    });
  }

  fallback(
    func: PromiseOrCallback<T>,
    isPromise: boolean,
    isFunction: boolean
  ) {
    this._fallback = promisifyIfFunction(func, isPromise, isFunction);
    return this._fallback;
  }
}

module.exports = Circuit;
