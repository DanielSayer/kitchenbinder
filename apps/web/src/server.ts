import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { boundedRequest } from "../../../scripts/http-body.mjs";

const handle = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request) {
    const bounded = await boundedRequest(request);
    if (bounded instanceof Response) return bounded;
    return handle(bounded);
  },
};
