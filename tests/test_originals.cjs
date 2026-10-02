"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {OriginalLoader, BrowserOriginalCache, fileKey, CapacityError} = require("../static/originals.js");
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {for (let i = 0; i < 200; i++) {if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2));} assert.fail("Timed out waiting for scheduler");}
const image = (id, size = 4, version = "1") => ({id, name: id + ".png", mimeType: "image/png", size: String(size), version});
class MemoryCache {
  constructor(limit = 100) {this.limit = limit; this.mode = "memory"; this.data = new Map();}
  get used() {return [...this.data.values()].reduce((sum, blob) => sum + blob.size, 0);}
  async open() {return new Map([...this.data].map(([key, blob]) => [key, blob.size]));}
  async read(key) {return this.data.get(key);}
  async write(key, blob, valid) {if (!valid()) throw new DOMException("Cancelled", "AbortError"); if (this.used + blob.size > this.limit) throw new CapacityError(); this.data.set(key, blob);}
  async remove(key) {this.data.delete(key);}
  async clear() {this.data.clear();}
}
function transport() {
  const calls = [], pending = new Map(); let active = 0, peak = 0;
  const fetcher = (url, options) => new Promise((resolve, reject) => {
    const id = decodeURIComponent(url.split("/").pop()); calls.push(id); active++; peak = Math.max(active, peak);
    const finish = (status = 200, bytes = 4, length = bytes) => {
      pending.delete(id); active--; options.signal.removeEventListener("abort", abort);
      resolve(new Response(new Uint8Array(bytes), {status, headers: {"Content-Type": "image/png", "Content-Length": String(length)}}));
    };
    const abort = () => {pending.delete(id); active--; reject(new DOMException("Cancelled", "AbortError"));};
    options.signal.addEventListener("abort", abort, {once: true}); pending.set(id, finish);
  });
  return {calls, pending, fetcher, get peak() {return peak;}, get active() {return active;}};
}
async function setup(t, files, {limit = 100, enabled = true, onUnauthorized, fetcher} = {}) {
  const cache = new MemoryCache(limit), network = transport();
  const loader = new OriginalLoader({cache, fetcher: fetcher || network.fetcher, enabled, delayMs: 1, onUnauthorized});
  t.after(() => loader.stop());
  await loader.initialise(); loader.sync(files, files);
  return {loader, cache, network};
}
test("all originals download sequentially; repeated sync/view does not redownload", async (t) => {
  const files = [image("a"), image("b"), image("c")];
  const {loader, network} = await setup(t, files);
  loader.sync(files); assert.deepEqual(network.calls, ["a"]);
  const opened = loader.original(files[0]); network.pending.get("a")();
  assert.equal((await opened).size, 4);
  await until(() => network.pending.has("b")); network.pending.get("b")();
  await until(() => network.pending.has("c")); network.pending.get("c")();
  await until(() => loader.status().ready === 3);
  await loader.original(files[0]); loader.sync(files);
  assert.deepEqual(network.calls, ["a", "b", "c"]); assert.equal(network.peak, 1);
});
test("pause finishes current file, stops queue, and resume keeps progress", async (t) => {
  const {loader, network} = await setup(t, [image("a"), image("b")]);
  loader.pause(true); network.pending.get("a")();
  await until(() => loader.status().ready === 1); await tick();
  assert.deepEqual(network.calls, ["a"]);
  loader.pause(false); await until(() => network.pending.has("b"));
  network.pending.get("b")(); await until(() => loader.status().ready === 2);
});
test("foreground priority adds at most one transfer; background waits for both", async (t) => {
  const files = [image("a"), image("b"), image("c"), image("d")];
  const {loader, network} = await setup(t, files);
  const foreground = loader.original(files[2]); assert.deepEqual(network.calls, ["a", "c"]);
  network.pending.get("a")(); await until(() => loader.status().ready === 1); await tick();
  assert.deepEqual(network.calls, ["a", "c"]);
  network.pending.get("c")(); await foreground;
  await until(() => network.pending.has("b")); assert.equal(network.peak, 2);
});
test("album/order priority affects the next file without restarting current", async (t) => {
  const files = [image("a"), image("b"), image("c")];
  const {loader, network} = await setup(t, files);
  loader.sync(files, [files[2]]); network.pending.get("a")();
  await until(() => network.pending.has("c")); assert.deepEqual(network.calls, ["a", "c"]);
});
test("rapidly opening many photos never starts more than two downloads", async (t) => {
  const files = [image("a"), image("b"), image("c"), image("d")];
  const {loader, network} = await setup(t, files);
  const opened = files.slice(1).map((file) => loader.original(file));
  assert.deepEqual(network.calls, ["a", "b"]);
  network.pending.get("b")(); await until(() => network.pending.has("d"));
  assert.equal(network.peak, 2); network.pending.get("d")(); await until(() => network.pending.has("c"));
  network.pending.get("c")(); network.pending.get("a")(); await Promise.all(opened);
  assert.equal(network.peak, 2); assert.equal(loader.status().ready, 4);
});
test("budget skips oversized originals, continues smaller files, and reports true ready count", async (t) => {
  const files = [image("a", 4), image("large", 50), image("b", 4), image("c", 4)];
  const {loader, network} = await setup(t, files, {limit: 8});
  network.pending.get("a")(); await until(() => network.pending.has("b")); network.pending.get("b")();
  await until(() => loader.status().blocked === 2);
  assert.equal(loader.status().ready, 2); assert.equal(loader.status().total, 4);
  assert.deepEqual(network.calls, ["a", "b"]);
  const opened = loader.original(files[3]); network.pending.get("c")(); assert.equal((await opened).size, 4);
  assert.equal(loader.status().ready, 2);
});
test("network error continues queue, retry fetches only failed originals", async (t) => {
  const files = [image("a"), image("b")];
  const {loader, network} = await setup(t, files);
  network.pending.get("a")(503); await until(() => network.pending.has("b")); network.pending.get("b")();
  await until(() => loader.status().ready === 1); assert.equal(loader.status().errors, 1);
  loader.retry(); await until(() => network.pending.has("a")); network.pending.get("a")();
  await until(() => loader.status().ready === 2); assert.equal(loader.status().errors, 0);
});
test("logout aborts transfers, clears cache, and rejects a late original", async (t) => {
  const files = [image("a"), image("b")]; const {loader, network, cache} = await setup(t, files);
  network.pending.get("a")(); await until(() => loader.status().ready === 1);
  await until(() => network.pending.has("b")); const late = loader.original(files[1]);
  const rejected = assert.rejects(late, {name: "AbortError"});
  await loader.stop(); await rejected; assert.equal(cache.used, 0); assert.equal(network.active, 0);
});
test("deleted/changed originals are invalidated and new uploads join the queue", async (t) => {
  const files = [image("a")]; const {loader, network, cache} = await setup(t, files);
  network.pending.get("a")(); await until(() => loader.status().ready === 1);
  const replacement = image("a", 4, "2"); loader.sync([replacement, image("new")]);
  await until(() => network.pending.has("a")); assert.equal(cache.data.has(fileKey(files[0])), false);
  network.pending.get("a")(); await until(() => network.pending.has("new"));
  network.pending.get("new")(); await until(() => loader.status().ready === 2);
  loader.sync([replacement]); await until(() => cache.data.size === 1); assert.equal(loader.status().total, 1);
});
test("content checksum avoids redownloading when only name/album/favorite changes", async (t) => {
  const file = {...image("a"), md5Checksum: "same-bytes"}; const {loader, network} = await setup(t, [file]);
  network.pending.get("a")(); await until(() => loader.status().ready === 1);
  loader.sync([{...file, name: "renamed.png", version: "99", appProperties: {favorite: "true"}}]);
  assert.equal(loader.status().ready, 1); assert.deepEqual(network.calls, ["a"]);
});
test("truncated original never counts as ready", async (t) => {
  const {loader, network, cache} = await setup(t, [image("a", 8)]);
  network.pending.get("a")(200, 4, 8); await until(() => loader.status().errors === 1);
  assert.equal(loader.status().ready, 0); assert.equal(cache.used, 0);
});
test("401 locks vault rather than retrying original downloads", async (t) => {
  let locked = 0; const {loader, network} = await setup(t, [image("a")], {onUnauthorized: () => {locked++; loader.stop();}});
  network.pending.get("a")(401); await until(() => locked === 1);
  assert.equal(loader.active, false); assert.equal(loader.status().ready, 0);
});
test("upload/offline hold pauses next request but manual viewing still works", async (t) => {
  const files = [image("a"), image("b")]; const {loader, network} = await setup(t, files);
  loader.hold("upload", true); loader.hold("offline", true); network.pending.get("a")();
  await until(() => loader.status().ready === 1); loader.hold("upload", false); await tick();
  assert.deepEqual(network.calls, ["a"]); loader.hold("offline", false);
  await until(() => network.pending.has("b"));
});
test("disabled automatic preload still caches explicitly opened originals", async (t) => {
  const file = image("a"); const {loader, network} = await setup(t, [file], {enabled: false});
  assert.equal(network.calls.length, 0); const opened = loader.original(file); network.pending.get("a")();
  await opened; assert.equal(loader.status().ready, 1); assert.equal(loader.status().paused, true);
});
test("missing browser-evicted original downloads again and corrects ready count", async (t) => {
  const file = image("a"); const {loader, network, cache} = await setup(t, [file]);
  network.pending.get("a")(); await until(() => loader.status().ready === 1); cache.data.clear();
  const opened = loader.original(file); await until(() => network.pending.has("a"));
  assert.equal(loader.status().ready, 0); network.pending.get("a")(); await opened;
  assert.equal(loader.status().ready, 1);
});
test("opening/releasing original URL preserves exact bytes and releases resources", async (t) => {
  const file = image("a"); const {loader, network} = await setup(t, [file]);
  const opened = loader.acquire(file); network.pending.get("a")(); const handle = await opened;
  assert.equal(handle.url.startsWith("blob:"), true);
  assert.deepEqual(new Uint8Array(await (await fetch(handle.url)).arrayBuffer()), new Uint8Array(4));
  handle.release(); assert.equal(loader.urls.size, 0);
});
test("unknown-length stream reports bytes and retains only completed file", async (t) => {
  let stream;
  const fetcher = async () => new Response(new ReadableStream({start(controller) {stream = controller;}}), {headers: {"Content-Type": "image/png"}});
  const file = image("unknown", 0); const {loader} = await setup(t, [file], {fetcher});
  await tick(); stream.enqueue(new Uint8Array(3)); await until(() => loader.status().current?.loaded === 3);
  assert.equal(loader.status().ready, 0); assert.equal(loader.status().current.total, 0);
  stream.enqueue(new Uint8Array(2)); stream.close(); await until(() => loader.status().ready === 1);
  assert.equal(loader.status().bytes, 5);
});
test("unknown-size original exceeding budget cancels without infinite retries", async (t) => {
  let requests = 0; const fetcher = async () => {requests++; return new Response(new Uint8Array(12));};
  const {loader} = await setup(t, [image("unknown", 0)], {limit: 8, fetcher});
  await until(() => loader.status().blocked === 1); await tick(); loader.pump();
  assert.equal(requests, 1); assert.equal(loader.status().ready, 0);
});
test("browser memory fallback obeys cap and clears private blobs", async () => {
  const cache = new BrowserOriginalCache({budgetMB: 1, memoryMB: 0.00001}); await cache.open("invalid-scope");
  await cache.write("a", new Blob([new Uint8Array(4)]));
  await assert.rejects(cache.write("b", new Blob([new Uint8Array(20)])), {name: "CapacityError"});
  assert.equal((await cache.read("a")).size, 4); await cache.clear(); assert.equal(cache.used, 0);
});
test("serialized cache writes cannot restore blobs after logout", async () => {
  const cache = new BrowserOriginalCache({budgetMB: 1}); let valid = true;
  const pending = cache.write("a", new Blob(["bytes"]), () => valid); valid = false;
  const cleared = cache.clear(); await assert.rejects(pending, {name: "AbortError"}); await cleared;
  assert.equal(cache.used, 0); assert.equal(await cache.read("a"), null);
});
test("logout while browser cache is opening also clears it when open finishes", async () => {
  const cache = new MemoryCache(); let finishOpen, clears = 0;
  cache.open = () => new Promise((resolve) => {finishOpen = resolve;});
  cache.clear = async () => {clears++; cache.data.clear();};
  const loader = new OriginalLoader({cache}); const opening = loader.initialise();
  await loader.stop(); cache.data.set("late", new Blob(["private"])); finishOpen(new Map([["late", 7]]));
  await opening; assert.equal(loader.active, false); assert.equal(cache.used, 0); assert.equal(clears, 2);
});
test("disk cache resumes on reload, prunes expired scopes, and handles quota", async (t) => {
  const previousCaches = globalThis.caches, previousSecure = globalThis.isSecureContext;
  const buckets = new Map(); const normalise = (key) => new URL(typeof key === "string" ? key : key.url, "https://vault.test").href;
  let quota = false;
  globalThis.isSecureContext = true;
  globalThis.caches = {keys: async () => [...buckets.keys()], delete: async (name) => buckets.delete(name), open: async (name) => {
    if (!buckets.has(name)) buckets.set(name, new Map()); const bucket = buckets.get(name);
    return {keys: async () => [...bucket.keys()].map((url) => new Request(url)),
      match: async (key) => bucket.get(normalise(key))?.clone(), delete: async (key) => bucket.delete(normalise(key)),
      put: async (key, response) => {if (quota) throw new DOMException("Full", "QuotaExceededError"); bucket.set(normalise(key), response.clone());}};
  }};
  t.after(() => {globalThis.caches = previousCaches; globalThis.isSecureContext = previousSecure;});
  buckets.set("vault-originals-v1-1000000000-aaaaaaaaaaaaaaaaaaaaaaaa", new Map());
  const scope = `${Math.floor(Date.now() / 1000)}-aaaaaaaaaaaaaaaaaaaaaaaa`;
  const cache = new BrowserOriginalCache({budgetMB: 1}); await cache.open(scope);
  assert.equal(cache.mode, "disk"); assert.equal(buckets.size, 1);
  const key = fileKey(image("a")); await cache.write(key, new Blob(["exact-original"], {type: "image/png"}));
  const reloaded = new BrowserOriginalCache({budgetMB: 1}); const inventory = await reloaded.open(scope);
  assert.equal(inventory.get(key), 14); assert.equal(await (await reloaded.read(key)).text(), "exact-original");
  quota = true; await assert.rejects(reloaded.write(fileKey(image("b")), new Blob(["more"])), {name: "CapacityError"});
  assert.equal(reloaded.limit, reloaded.used); await reloaded.clear(); assert.equal(buckets.size, 0);
});
