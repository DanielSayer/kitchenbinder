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

// Send a complete, length-delimited rejection immediately and advertise close
// so clients cannot reuse the connection. Delay end() while discarding upload
// bytes for at most one second: closing with unread TCP data can reset the socket
// before the client receives the response.
export function rejectIncomingBody(
  incoming,
  outgoing,
  status,
  body,
  headers = {},
) {
  const bytes = Buffer.from(body);
  outgoing.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
    "cache-control": "no-store",
    connection: "close",
    "content-length": bytes.byteLength,
  });
  outgoing.flushHeaders();
  outgoing.write(bytes);
  let deadline;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    outgoing.end();
  };
  if (incoming.readableEnded) finish();
  else {
    deadline = setTimeout(finish, 1_000);
    incoming.socket.once("close", () => {
      finished = true;
      clearTimeout(deadline);
      incoming.off("end", finish);
    });
    incoming.once("end", finish);
    incoming.resume();
  }
}
