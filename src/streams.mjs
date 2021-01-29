import { fstat } from "fs";
import { pipeline } from "stream";
import rw from "rw-stream";
import { Transform, NukableTransform } from "./transform.mjs";

async function process_stream (
  readStream,
  writeStream,
  { separator, processFunc, encoding, decodeBuffers, truncate }
) {

  let transformStream;

  if (processFunc.withLimit) {
    transformStream = new NukableTransform({
        separator,
        process: processFunc,
        encoding,
        decodeBuffers,
        withFalloutShelter: !truncate
    });

    let limitReached = false;
    processFunc._cb_limit = () => {
      if (limitReached) {
        return Symbol.for("notified");
      } else {
        limitReached = true;
        transformStream.detonateTheBombNow = true
        // starting from v14.0.0, The pipeline will wait for the 'close' event
        // for non-duplex & non-legacy streams created with the emitClose option.
        // so marking the end of the readStream manually is required.
        if(truncate)
          readStream.push(null);
      }
    }
  } else {
    transformStream = new Transform({
      separator,
      process: processFunc,
      encoding,
      decodeBuffers
    })
  }

  return new Promise((resolve, reject) => {
    pipeline (
      readStream,
      transformStream,
      writeStream,
      err => err ? reject(err) : resolve(writeStream)
    );
  });
}


async function rw_stream(filepath, options) {
  const { fd, readStream, writeStream } = await rw(filepath);

  if (
    await new Promise(
      (resolve, reject) =>
        fstat(fd, (err, status) => err ? reject(err) : resolve(status.isFile()))
    ) // fs.open won't throw a complaint, so it's our duty.
  )
    return process_stream(readStream, writeStream, options)
            .then(() => void 0); // not leaking reference to local writeStream
  else
    throw new Error(`update-file-content: filepath ${filepath} is invalid.`);
}

export { rw_stream, process_stream };