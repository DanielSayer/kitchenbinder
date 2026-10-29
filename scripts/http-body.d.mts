export const TRPC_MAX_BATCH_SIZE: 5;
export const BODY_READ_TIMEOUT_MS: number;
export const PHOTO_UPLOAD_PATH: "/api/recipes/imports/photos";
export function bodyByteLimit(pathname: string): number;
export function bodyReadTimeoutMs(pathname: string): number;
export function bodyRejection(status: 408 | 413): Response;
export function boundedRequest(
  request: Request,
  timeoutMs?: number,
): Promise<Request | Response>;
