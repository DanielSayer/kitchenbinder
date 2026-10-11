import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { setImmediate as tick } from "node:timers/promises";
import { fetchPage, PAGE_ERROR } from "../fetch-page.ts";

// Deliberately run without an uncaughtException handler: an escaped callback
// error must kill this child so the parent test can detect the worker crash.
const scenario = process.argv[2];
const html = "<main>A second request still works.</main>";
let requests = 0;
http.get = (_url, _options, callback) => {
  const request = new EventEmitter();
  const first = requests++ === 0;
  setImmediate(() => {
    const response = new EventEmitter();
    response.statusCode = first && scenario === "rejected-stream" ? 403 : 302;
    response.headers = {
      location: scenario === "malformed" ? "http://[" : "http://127.0.0.1/",
    };
    response.resume = () => {
      if (scenario !== "malformed")
        setImmediate(() => {
          response.emit("error", new Error("drained response failed"));
        });
    };
    if (!first) {
      response.statusCode = 200;
      response.headers = { "content-type": "text/html" };
    }
    callback(response);
    if (!first) {
      response.emit("data", Buffer.from(html));
      response.emit("end");
    }
  });
  return request;
};

await assert.rejects(fetchPage("http://8.8.8.8/"), {
  message: PAGE_ERROR,
});
assert.equal(await fetchPage("http://8.8.8.8/next"), html);
await tick();
process.stdout.write("FETCH_REJECTED_AND_CONTINUED\n");
