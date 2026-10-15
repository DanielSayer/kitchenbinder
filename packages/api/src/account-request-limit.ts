// Per-process admission. The edge must enforce aggregate limits across replicas.
// Expiry and a hard entry cap keep account churn from growing this map forever.
export class AccountRequestLimit {
  private readonly windows = new Map<string, { start: number; used: number }>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs = 60_000,
    private readonly maximumAccounts = 10_000,
  ) {}

  take(accountId: string, cost = 1, now = Date.now()): number | null {
    let window = this.windows.get(accountId);
    if (window && now - window.start >= this.windowMs) {
      this.windows.delete(accountId);
      window = undefined;
    }
    if (!window) {
      if (this.windows.size >= this.maximumAccounts) {
        for (const [id, entry] of this.windows) {
          if (now - entry.start >= this.windowMs) this.windows.delete(id);
        }
      }
      if (this.windows.size >= this.maximumAccounts)
        return Math.ceil(this.windowMs / 1000);
      window = { start: now, used: 0 };
      this.windows.set(accountId, window);
    }
    if (window.used + cost > this.maximum)
      return Math.max(
        1,
        Math.ceil((window.start + this.windowMs - now) / 1000),
      );
    window.used += cost;
    return null;
  }
}
