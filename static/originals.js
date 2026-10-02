"use strict";
// Original bytes only. No resizing, transcoding, or credentials in cache keys.
((root) => {
const MB = 1024 ** 2;
const PREFIX = "vault-originals-v1-";
const fileKey = (file) => `/__vault_originals__/${encodeURIComponent(file.id)}?v=${encodeURIComponent(file.md5Checksum || file.version || file.modifiedTime || file.createdTime || "")}`;
const abortError = () => new DOMException("Cancelled", "AbortError");
class CapacityError extends Error {constructor() {super("Cache capacity reached"); this.name = "CapacityError";}}

class BrowserOriginalCache {
  constructor({budgetMB = 512, memoryMB = 64} = {}) {
    this.requestedBudget = budgetMB * MB; this.memoryBudget = memoryMB * MB;
    this.memory = new Map(); this.sizes = new Map(); this.queue = Promise.resolve();
    this.mode = "memory"; this.limit = Math.min(this.requestedBudget, this.memoryBudget);
  }
  serial(action) {
    const result = this.queue.then(action); this.queue = result.catch(() => {}); return result;
  }
  async open(scope) {
    if (!/^[0-9]{10}-[a-f0-9]{24}$/.test(scope || "")) return new Map();
    this.name = PREFIX + scope;
    try {
      if (!root.caches || !root.isSecureContext) return new Map();
      const estimate = await root.navigator?.storage?.estimate().catch(() => ({})) || {};
      // Leave most remaining device storage to the browser and other sites.
      if (estimate.quota) this.limit = Math.min(this.requestedBudget, Math.max(0, (estimate.quota - (estimate.usage || 0)) * 0.3));
      else this.limit = this.requestedBudget;
      for (const name of await root.caches.keys()) {
        const created = Number(name.slice(PREFIX.length).split("-")[0]);
        if (name.startsWith(PREFIX) && name !== this.name && created && Date.now() / 1000 - created > 12 * 3600) await root.caches.delete(name);
      }
      this.disk = await root.caches.open(this.name); this.mode = "disk";
      for (const request of await this.disk.keys()) {
        const response = await this.disk.match(request);
        const size = Number(response?.headers.get("X-Vault-Bytes"));
        const url = new URL(request.url); const key = url.pathname + url.search;
        if (size > 0 && url.pathname.startsWith("/__vault_originals__/")) this.sizes.set(key, size);
        else await this.disk.delete(request);
      }
      // A smaller edited setting also limits files kept from an earlier page load.
      for (const key of [...this.sizes.keys()].reverse()) {
        if (this.used <= this.limit) break;
        await this.remove(key);
      }
    } catch {
      this.disk = null; this.mode = "memory"; this.sizes.clear();
      this.limit = Math.min(this.requestedBudget, this.memoryBudget);
    }
    return new Map(this.sizes);
  }
  get used() {return [...this.sizes.values()].reduce((sum, size) => sum + size, 0);}
  async read(key) {
    if (!this.disk) return this.memory.get(key) || null;
    const response = await this.disk.match(key);
    return response ? response.blob() : null;
  }
  write(key, blob, valid = () => true) {
    return this.serial(async () => {
      if (!valid()) throw abortError();
      if (this.used - (this.sizes.get(key) || 0) + blob.size > this.limit) throw new CapacityError();
      try {
        if (this.disk) await this.disk.put(key, new Response(blob, {headers: {"Content-Type": blob.type, "X-Vault-Bytes": String(blob.size)}}));
        else this.memory.set(key, blob);
      } catch (error) {
        if (error.name === "QuotaExceededError") {this.limit = this.used; throw new CapacityError();}
        throw error;
      }
      this.sizes.set(key, blob.size);
      if (!valid()) {if (this.disk) await this.disk.delete(key); else this.memory.delete(key); this.sizes.delete(key); throw abortError();}
    });
  }
  remove(key) {
    return this.serial(async () => {
      if (this.disk) await this.disk.delete(key); else this.memory.delete(key);
      this.sizes.delete(key);
    });
  }
  clear() {
    return this.serial(async () => {
      this.memory.clear(); this.sizes.clear();
      if (this.name && root.caches) await root.caches.delete(this.name);
    });
  }
}

class OriginalLoader {
  constructor({cache, fetcher = (...args) => root.fetch(...args), onChange = () => {}, onUnauthorized = () => {}, enabled = true, delayMs = 180} = {}) {
    this.cache = cache; this.fetcher = fetcher; this.onChange = onChange; this.onUnauthorized = onUnauthorized;
    this.enabled = enabled; this.delayMs = delayMs; this.generation = 0; this.active = false;
    this.files = []; this.fileKeys = new Set(); this.order = []; this.ready = new Map(); this.jobs = new Map();
    this.errors = new Map(); this.blocked = new Set(); this.holds = new Set(); this.urls = new Set();
    this.urgentQueue = new Map();
    this.paused = !enabled; this.initialising = false; this.timer = null;
  }
  async initialise(scope) {
    const generation = ++this.generation;
    this.active = true; this.initialising = true; this.notify();
    const ready = await this.cache.open(scope);
    if (generation !== this.generation) {await this.cache.clear(); return;}
    this.ready = ready; this.initialising = false; this.notify(); this.pump();
  }
  sync(files, priority = []) {
    this.files = files.filter((file) => (file.mimeType || "").startsWith("image/"));
    const all = new Map(this.files.map((file) => [fileKey(file), file]));
    this.fileKeys = new Set(all.keys());
    const first = priority.map(fileKey).filter((key) => all.has(key));
    this.order = [...new Set([...first, ...all.keys()])];
    for (const key of this.ready.keys()) {
      if (!all.has(key)) {this.ready.delete(key); this.cache.remove(key).then(() => {this.blocked.clear(); this.notify(); this.pump();}).catch(() => {});}
    }
    for (const [key, job] of this.jobs) if (!all.has(key)) job.controller.abort();
    for (const [key, pending] of this.urgentQueue) if (!all.has(key)) {pending.reject(abortError()); this.urgentQueue.delete(key);}
    for (const key of this.errors.keys()) if (!all.has(key)) this.errors.delete(key);
    this.blocked.clear(); this.notify(); this.pump();
  }
  status() {
    const keys = this.fileKeys;
    const jobs = [...this.jobs.values()].filter((job) => keys.has(job.key));
    return {total: keys.size, ready: [...this.ready.keys()].filter((key) => keys.has(key)).length,
      bytes: [...this.ready].filter(([key]) => keys.has(key)).reduce((sum, [, size]) => sum + size, 0),
      limit: this.cache.limit, mode: this.cache.mode, paused: this.paused, holds: [...this.holds],
      initialising: this.initialising, errors: [...this.errors.keys()].filter((key) => keys.has(key)).length,
      blocked: [...this.blocked].filter((key) => keys.has(key)).length,
      current: jobs.find((job) => job.urgent) || jobs[0] || null};
  }
  notify() {this.onChange(this.status());}
  isReady(file) {return this.ready.has(fileKey(file));}
  pause(value) {this.paused = value; this.notify(); if (!value) this.pump();}
  hold(reason, value) {value ? this.holds.add(reason) : this.holds.delete(reason); this.notify(); if (!value) this.pump();}
  retry() {this.errors.clear(); this.blocked.clear(); this.notify(); this.pump();}
  pump() {
    if (!this.active || this.initialising || this.paused || this.holds.size || this.jobs.size || this.timer) return;
    const files = new Map(this.files.map((file) => [fileKey(file), file]));
    const remaining = this.cache.limit - this.cache.used;
    let next;
    for (const key of this.order) {
      if (this.ready.has(key) || this.errors.has(key) || this.blocked.has(key)) continue;
      const file = files.get(key); if (!file) continue;
      if (remaining <= 0 || Number(file.size || 0) > remaining) {this.blocked.add(key); continue;}
      this.blocked.delete(key); next = file; break;
    }
    if (!next) {this.notify(); return;}
    this.download(next, false).catch(() => {});
  }
  async original(file) {
    if (!this.active) throw abortError();
    const generation = this.generation, key = fileKey(file);
    let blob;
    if (this.ready.has(key)) {
      try {blob = await this.cache.read(key);} catch {}
      if (!blob) {this.ready.delete(key); this.notify();}
    }
    if (generation !== this.generation) throw abortError();
    if (!blob) blob = await (this.jobs.get(key)?.promise || this.download(file, true));
    if (generation !== this.generation) throw abortError();
    return blob;
  }
  async acquire(file) {
    const blob = await this.original(file);
    if (!this.active) throw abortError();
    const url = root.URL.createObjectURL(blob); this.urls.add(url);
    return {url, release: () => {if (this.urls.delete(url)) root.URL.revokeObjectURL(url);}};
  }
  drainUrgent() {
    if (!this.active) return;
    while (this.jobs.size < 2 && this.urgentQueue.size) {
      const [key, pending] = [...this.urgentQueue].pop(); this.urgentQueue.delete(key);
      this.download(pending.file, true).then(pending.resolve, pending.reject);
    }
  }
  download(file, urgent) {
    const key = fileKey(file);
    if (this.jobs.has(key)) return this.jobs.get(key).promise;
    if (urgent && this.jobs.size >= 2) {
      if (this.urgentQueue.has(key)) return this.urgentQueue.get(key).promise;
      let resolve, reject;
      const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
      this.urgentQueue.set(key, {file, promise, resolve, reject}); return promise;
    }
    const generation = this.generation, controller = new AbortController();
    const valid = () => this.active && generation === this.generation && !controller.signal.aborted && this.fileKeys.has(key);
    const job = {key, file, urgent, controller, loaded: 0, total: Number(file.size) || 0};
    this.jobs.set(key, job); this.notify();
    // Foreground viewing may use one extra request. Background remains sequential,
    // waits for both to finish, and never discards an already downloaded partial file.
    job.promise = (async () => {
      let response;
      try {
        response = await this.fetcher(`/stream/${encodeURIComponent(file.id)}`, {credentials: "same-origin", cache: "no-store", signal: controller.signal});
        if (response.status === 401) {this.onUnauthorized(); throw abortError();}
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!valid()) throw abortError();
        job.total = Number(response.headers.get("Content-Length")) || job.total;
        const remaining = this.cache.limit - this.cache.used;
        if (!urgent && job.total > remaining) {controller.abort(); throw new CapacityError();}
        const limit = urgent ? Math.max(500 * MB, job.total) : remaining;
        let blob;
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = [];
          let lastUpdate = 0;
          try {
            for (;;) {
              const {done, value} = await reader.read(); if (done) break;
              if (!valid()) throw abortError();
              job.loaded += value.byteLength;
              if (job.loaded > limit) {controller.abort(); throw new CapacityError();}
              chunks.push(value);
              if (Date.now() - lastUpdate > 250) {lastUpdate = Date.now(); this.notify();}
            }
          } catch (error) {await reader.cancel().catch(() => {}); throw error;}
          finally {reader.releaseLock();}
          blob = new Blob(chunks, {type: response.headers.get("Content-Type") || file.mimeType});
        } else {blob = await response.blob(); job.loaded = blob.size; if (blob.size > limit) throw new CapacityError();}
        if (!valid()) throw abortError();
        if (!blob.size || (job.total && blob.size !== job.total)) throw new Error("Incomplete original");
        try {
          await this.cache.write(key, blob, valid);
          if (!valid()) throw abortError();
          this.ready.set(key, blob.size); this.errors.delete(key); this.blocked.delete(key);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          if (error.name === "CapacityError") this.blocked.add(key);
          else this.errors.set(key, "storage");
          if (!urgent) throw error;
          // A full/disabled cache must never prevent opening the original.
        }
        return blob;
      } catch (error) {
        if (generation === this.generation) {
          if (error.name === "CapacityError") this.blocked.add(key);
          else if (error.name !== "AbortError") this.errors.set(key, "network");
        }
        throw error;
      } finally {
        if (generation === this.generation) {
          this.jobs.delete(key); this.drainUrgent(); this.notify();
          if (!this.jobs.size) {
            this.timer = setTimeout(() => {this.timer = null; this.pump();}, this.delayMs);
          }
        }
      }
    })();
    return job.promise;
  }
  async stop({clear = true} = {}) {
    this.active = false; ++this.generation;
    clearTimeout(this.timer); this.timer = null;
    for (const job of this.jobs.values()) job.controller.abort();
    for (const pending of this.urgentQueue.values()) pending.reject(abortError());
    this.urgentQueue.clear();
    this.jobs.clear(); this.files = []; this.fileKeys.clear(); this.order = []; this.ready.clear(); this.errors.clear(); this.blocked.clear();
    for (const url of this.urls) root.URL.revokeObjectURL(url);
    this.urls.clear(); this.notify();
    if (clear) await this.cache.clear();
  }
}
const api = {BrowserOriginalCache, OriginalLoader, fileKey, CapacityError};
if (typeof module === "object" && module.exports) module.exports = api;
else root.VaultOriginals = api;
})(typeof window === "object" ? window : globalThis);
