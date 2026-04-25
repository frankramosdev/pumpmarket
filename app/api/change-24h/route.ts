import { NextResponse } from "next/server";
import { COINS, CG_MAP } from "@/lib/coins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simple in-memory cache — CoinGecko's free tier doesn't love being polled
// by every browser tab we serve, so we cache for 60s and let all visitors
// share the same fetch.
type Cache = { fetchedAt: number; data: Record<string, { change24h: number }> };
let cache: Cache | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  try {
    const ids = Object.values(CG_MAP).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const raw = await res.json();

    const data: Record<string, { change24h: number }> = {};
    for (const c of COINS) {
      const d = raw[CG_MAP[c.id]];
      if (d?.usd_24h_change != null) {
        data[c.id] = { change24h: d.usd_24h_change };
      }
    }
    cache = { fetchedAt: Date.now(), data };
    return NextResponse.json(data);
  } catch (err) {
    // Serve stale if we have it
    if (cache) return NextResponse.json(cache.data);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    );
  }
}
