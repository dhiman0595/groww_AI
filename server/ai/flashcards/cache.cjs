class FlashcardsTtlCache {
  constructor(options = {}) {
    this.ttlMs = Math.max(60_000, Math.min(Number(options.ttlMs) || 86_400_000, 604_800_000));
    this.maxEntries = Math.max(16, Math.min(Number(options.maxEntries) || 500, 10_000));
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.pruneExpired();
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.map.delete(key);
      }
    }
  }
}

module.exports = {
  FlashcardsTtlCache,
};
