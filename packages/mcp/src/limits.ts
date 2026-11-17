import { AccountRequestLimit } from "@prep-sheet/api/account-request-limit";

/** Per-user, per-minute budgets. Per process; aggregate limits belong at the edge. */
const perMinute = 120;

/** Every authenticated HTTP request, including tool listing. */
export const requestAdmission = new AccountRequestLimit(perMinute);

/** Tool work, weighted by `Tool.cost` (e.g. one unit per shopping line). */
export const toolWork = new AccountRequestLimit(perMinute);
