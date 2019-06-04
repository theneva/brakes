import stream from 'stream';
import * as utils from './utils';
import Stats from './stats';
import Brakes from './Brakes';

class GlobalStats<T = unknown> {
  private _brakesInstances: Brakes<T>[] = [];

  // create raw stream
  private _rawStream = new stream.Readable({
    objectMode: true,
    highWaterMark: 0
  });

  // create hystrix stream
  private _hystrixStream = new stream.Transform({
    objectMode: true,
    highWaterMark: 0
  });

  constructor() {
    this._rawStream._read = () => {};
    this._rawStream.resume();

    this._hystrixStream._transform = this._transformToHystrix;
    this._hystrixStream.resume();

    // connect the streams
    this._rawStream.pipe(this._hystrixStream);
  }

  /* return number of instances being tracked */
  instanceCount() {
    return this._brakesInstances.length;
  }

  /* register a new instance apply listener */
  register(instance: Brakes<T>) {
    this._brakesInstances.push(instance);
    instance.on('snapshot', this._globalListener.bind(this));
  }

  /* deregister an existing instance and remove listener */
  deregister(instance: Brakes<T>) {
    const idx = this._brakesInstances.indexOf(instance);
    if (idx > -1) {
      this._brakesInstances.splice(idx, 1);
    }
    instance.removeListener('snapshot', this._globalListener.bind(this));
  }

  /* listen to event and pipe to stream */
  _globalListener(stats: Stats) {
    if (!stats || typeof stats !== 'object') return;
    if (!this._rawStream.isPaused()) {
      this._rawStream.push(JSON.stringify(stats));
    }
  }

  /* transform stats object into hystrix object */
  _transformToHystrix(
    stats: string,
    _encoding: null, // required to be a stream transform
    callback: (err: Error | null, data?: string) => void
  ) {
    try {
      const rawStats = JSON.parse(stats);
      const mappedStats = utils.mapToHystrixJson(rawStats);
      return callback(null, `data: ${JSON.stringify(mappedStats)}\n\n`);
    }
    catch (err) {
      return callback(err);
    }
  }

  /* listen to event and pipe to stream */
  getHystrixStream() {
    return this._hystrixStream;
  }

  /* listen to event and pipe to stream */
  getRawStream() {
    return this._rawStream;
  }
}

const instance = new GlobalStats();
export default instance;
