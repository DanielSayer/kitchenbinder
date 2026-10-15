// Readable.toWeb().cancel() destroys IncomingMessage's socket, preventing a
// controlled 413/408 response. Pause on cancellation and close after replying.
export function incomingBody(incoming) {
  let cleanup;
  return new ReadableStream(
    {
      start(controller) {
        const onData = (chunk) => {
          incoming.pause();
          controller.enqueue(chunk);
        };
        const onEnd = () => {
          cleanup();
          controller.close();
        };
        const onError = (error) => {
          cleanup();
          controller.error(error);
        };
        cleanup = () => {
          incoming.off("data", onData);
          incoming.off("end", onEnd);
          incoming.off("error", onError);
        };
        incoming.on("data", onData);
        incoming.once("end", onEnd);
        incoming.once("error", onError);
        incoming.pause();
      },
      pull() {
        incoming.resume();
      },
      cancel() {
        incoming.pause();
        cleanup();
        incoming.once("error", () => {});
      },
    },
    { highWaterMark: 0 },
  );
}

// A TCP reset while the client is still uploading can swallow the 413/408.
// Discard bytes without retaining/parsing them for at most one second, send the
// response immediately, then close the connection after the upload ends.
export function finishRejectedBody(incoming, outgoing) {
  const socket = incoming.socket;
  const deadline = setTimeout(() => socket.destroy(), 1_000);
  const close = () => {
    clearTimeout(deadline);
    if (outgoing.writableFinished) socket.end();
    else outgoing.once("finish", () => socket.end());
  };
  socket.once("close", () => clearTimeout(deadline));
  if (incoming.readableEnded) close();
  else {
    incoming.once("end", close);
    incoming.resume();
  }
}
