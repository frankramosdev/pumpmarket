import { COINS, FEED_TO_COIN, HERMES_URL, type PriceTick } from "@/lib/coins";

// Run on Node so we get long-lived fetch streaming and can share upstream
// state across requests in the same server instance.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------
// Architecture
//
//   Browsers  <---SSE---  /api/prices/stream (this file)
//                                 ^
//                                 | ONE shared upstream
//                                 v
//                         hermes.pyth.network SSE
//
// Pyth publishes ~400ms updates for all 10 feeds. We keep a single
// upstream connection alive as long as at least one browser is
// connected, and fan out the parsed ticks to every client.
// ---------------------------------------------------------------

type Client = {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval>;
};

const encoder = new TextEncoder();
const clients = new Map<number, Client>();
let nextClientId = 1;

let upstreamAbort: AbortController | null = null;
const lastPrices = new Map<string, PriceTick>();

function sseFrame(data: string) {
  return encoder.encode(`data: ${data}\n\n`);
}

function broadcast(tick: PriceTick) {
  const frame = sseFrame(JSON.stringify(tick));
  for (const client of clients.values()) {
    try {
      client.controller.enqueue(frame);
    } catch {
      // client stream is gone; will be removed via its cancel handler
    }
  }
}

function handleFrame(frame: string) {
  // Pyth SSE frames: each "data:" line is a complete JSON payload
  const dataLine = frame
    .split("\n")
    .find(l => l.startsWith("data:"));
  if (!dataLine) return;

  const payload = dataLine.slice(5).trim();
  if (!payload) return;

  let obj: {
    parsed?: Array<{
      id: string;
      price: { price: string; expo: number; publish_time: number };
    }>;
  };
  try {
    obj = JSON.parse(payload);
  } catch {
    return;
  }
  if (!obj.parsed?.length) return;

  for (const feed of obj.parsed) {
    const coin = FEED_TO_COIN[feed.id];
    if (!coin) continue;
    const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
    if (!isFinite(price) || price <= 0) continue;

    const tick: PriceTick = {
      coin,
      price,
      publishTime: feed.price.publish_time * 1000,
    };
    lastPrices.set(coin, tick);
    broadcast(tick);
  }
}

async function runUpstream(signal: AbortSignal) {
  const params = COINS.map(c => `ids[]=${c.feed}`).join("&");
  const url = `${HERMES_URL}/v2/updates/price/stream?${params}&parsed=true&allow_unordered=true`;

  let backoff = 500;
  while (!signal.aborted) {
    try {
      console.log(`[pyth] connecting upstream (${clients.size} client(s))`);
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`Hermes HTTP ${res.status}`);
      backoff = 500;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          handleFrame(buf.slice(0, idx));
          buf = buf.slice(idx + 2);
        }
      }
      console.log("[pyth] upstream ended, reconnecting");
    } catch (err) {
      if (signal.aborted) return;
      console.warn(
        `[pyth] upstream error: ${(err as Error).message}, retry in ${backoff}ms`
      );
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 10_000);
    }
  }
}

function ensureUpstream() {
  if (upstreamAbort) return;
  upstreamAbort = new AbortController();
  runUpstream(upstreamAbort.signal).finally(() => {
    upstreamAbort = null;
  });
}

function stopUpstreamIfIdle() {
  if (clients.size === 0 && upstreamAbort) {
    console.log("[pyth] no clients, aborting upstream");
    upstreamAbort.abort();
    upstreamAbort = null;
  }
}

export async function GET() {
  const id = nextClientId++;
  let client: Client | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* stream closed */
        }
      }, 15_000);

      client = { id, controller, heartbeat };
      clients.set(id, client);
      console.log(`[pyth] client ${id} connected (${clients.size} total)`);

      // Send cached prices immediately so the UI has data to render
      controller.enqueue(encoder.encode(`: hello\n\n`));
      for (const tick of lastPrices.values()) {
        controller.enqueue(sseFrame(JSON.stringify(tick)));
      }

      ensureUpstream();
    },
    cancel() {
      clients.delete(id);
      if (client) clearInterval(client.heartbeat);
      console.log(`[pyth] client ${id} disconnected (${clients.size} left)`);
      stopUpstreamIfIdle();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx/cloudflare buffering
    },
  });
}
