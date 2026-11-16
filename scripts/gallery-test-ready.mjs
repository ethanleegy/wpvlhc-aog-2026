// The API is ready before the Worker and both web apps have started. Wait for
// the whole demo stack so the first browser test cannot race their startup.
export default async function galleryTestReady() {
  const pending = new Set([
    "http://127.0.0.1:5999/v1/ready",
    "http://127.0.0.1:8787/ready",
    "http://127.0.0.1:5174/",
    "http://127.0.0.1:5173/",
  ]);
  const deadline = Date.now() + 45_000;
  while (pending.size && Date.now() < deadline) {
    await Promise.all([...pending].map(async url => {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) pending.delete(url); } catch {}
    }));
    if (pending.size) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (pending.size) throw new Error(`Local gallery services did not become ready: ${[...pending].join(", ")}`);
}
