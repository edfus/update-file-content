"use strict";
const { ok } = require("assert");
const { Transform: Node_Transform } = require("stream");

const kSource = Symbol("source");
const kNuked = Symbol("nuked");

class Transform extends Node_Transform {
  constructor ({ 
    separator,
    processFunc,
    decodeBuffers,
    encoding,
    maxLength,
    readableObjectMode,
    channel
  }) {
    super({
      decodeStrings: false, // Accept string input
      encoding: encoding,
      readableObjectMode
    });

    this.separator = separator;
    this.process = processFunc;

    this.decoder = new TextDecoder(decodeBuffers);

    this[kSource] = '';
    this.maxLength = maxLength;

    this.channel = channel;
  }

  async _transform (texts, encoding, cb) {
    if(encoding === "buffer") {
      texts = this.decoder.decode(texts, { stream: true });
    }

    const parts = texts.split(this.separator);
    this[kSource] = this[kSource].concat(parts[0]);

    if (parts.length === 1) {
      if(this[kSource].length > this.maxLength) {
        return cb(
          new Error(
            `Maximum buffer length ${this.maxLength} reached: ...`
                .concat(
                  this[kSource].slice(
                    this[kSource].length - 90,
                    this[kSource].length
                  )
                )
          )
        )
      } else {
        return cb();
      }
    }

    // length > 1
    parts[0] = this[kSource];

    for (let i = 0, ret; i < parts.length - 1; i++) {
      try {
        ret = await this.process(parts[i], false);
      } catch (err) {
        return cb(err);
      }

      if(this.push(ret) === false) {
        if (this.destroyed || this[kNuked]) {
          this[kSource] = '';
          return cb();
        }
      }
    }

    this[kSource] = parts[parts.length - 1];
    return cb();
  }

  async _flush (cb) {
    try {
      this.push(
        await this.process(this[kSource].concat(this.decoder.decode()), true)
      );
      await this.channel.final();
    } catch (err) {
      return cb(err);
    }

    return cb();
  }
}

/**
 * push will return false when highWaterMark reached, signaling that
 * additional chunks of data can't be pushed.
 * ...but as Node.js will buffer any excess internally, and our output 
 * data are in small amounts, there won't be any actual differences when
 * no handling logic written out.
 * 
 * It might be the reason why Node didn't provide something like the drain 
 * event for Writables in Transform Stream.
 * 
 * https://github.com/nodejs/help/issues/1791
 * 
 * https://github.com/nodejs/node/blob/040a27ae5f586305ee52d188e3654563f28e99ce/lib/internal/streams/pipeline.js#L132
 */

class NukableTransform extends Transform {
  constructor (options) {
    super(options);

    this.detonateTheBombNow = false;
    this.withFalloutShelter = options.withFalloutShelter;
  }

  push (...args) {
    if ( !this.detonateTheBombNow ) {
      return super.push(...args);
    } else {
      if (this.withFalloutShelter) { // preserve the rest
        super.push(...args);
        this.push = super.push;

        this._transform = (
          (texts, encoding, cb) => {
            this.push(this[kSource]); // next 
            this[kSource] = "";

            this._transform = (texts, encoding, cb) => {
              if(encoding === "buffer") {
                this.push(this.decoder.decode(texts, { stream: true }));
              } else {
                this.push(texts);
              }
              return cb();
            }
            
            this._transform(texts, encoding, cb);
          }
        );

        this._flush = cb => {
          // flush has been called first, and here comes the end
          // so there is no need for resetting _transform now
          this.push (
            this[kSource].concat(this.decoder.decode())
          );
          return cb();
        };
        
        return true;
      } else { // wasted
        if (!this[kNuked]) {
          this[kNuked] = true;
          this.end(); // close the writable side

          super.push(...args); // push the last data
          super.push(null);    // it's the end

          return false;
        } else {
          ok(!args[0]);
          // https://github.com/nodejs/node/blob/51b43675067fafaad0abd7d4f62a6a5097db5044/lib/internal/streams/transform.js#L159
          return super.push(null);
        }
      }
    }
  }
}

module.exports = {  Transform, NukableTransform  };