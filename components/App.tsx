"use client";

import { useEffect, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  Zap,
  Trophy,
  X,
  Check,
  ChevronRight,
  Activity,
  Wallet,
} from "lucide-react";
import { COINS, COIN_BY_ID, type Coin, type PriceTick } from "@/lib/coins";

const STARTING_BALANCE = 10_000;
const ROUND_SECONDS = 60;

// ---------- Types ----------

type PriceInfo = { price: number; change24h?: number; updatedAt?: number };

type QuickBet = {
  id: string;
  type: "quick";
  coinId: string;
  direction: "up" | "down";
  stake: number;
  entryPrice: number;
  createdAt: number;
  expiresAt: number;
};

type TargetBet = {
  id: string;
  type: "target";
  coinId: string;
  direction: "above" | "below";
  stake: number;
  target: number;
  entryPrice: number;
  multiplier: number;
  createdAt: number;
  expiresAt: number;
};

type Bet = QuickBet | TargetBet;

type SettledBet = Bet & {
  exitPrice: number;
  won: boolean;
  payout: number;
  settledAt: number;
};

type Toast = { kind: "win" | "loss"; msg: string };

// ---------- Formatters ----------

const fmtUSD = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(6);
};
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

// ---------------------------------------------------------------
// App
// ---------------------------------------------------------------

export function App() {
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [history, setHistory] = useState<Record<string, { t: number; p: number }[]>>({});
  const [selected, setSelected] = useState<string>("SOL");
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [activeBets, setActiveBets] = useState<Bet[]>([]);
  const [settled, setSettled] = useState<SettledBet[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [tab, setTab] = useState<"quick" | "target">("quick");
  const [quickStake, setQuickStake] = useState(100);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());

  // ----- SSE subscription to our own server's Pyth proxy -----
  useEffect(() => {
    const es = new EventSource("/api/prices/stream");
    const lastChartWrite: Record<string, number> = {};

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const tick = JSON.parse(e.data) as PriceTick;
        if (!COIN_BY_ID[tick.coin]) return;

        setPrices((prev) => ({
          ...prev,
          [tick.coin]: {
            ...(prev[tick.coin] ?? {}),
            price: tick.price,
            updatedAt: Date.now(),
          },
        }));

        // Throttle chart writes to ~1/sec per coin
        const t = Date.now();
        if (!lastChartWrite[tick.coin] || t - lastChartWrite[tick.coin] >= 1000) {
          lastChartWrite[tick.coin] = t;
          setHistory((prev) => {
            const arr = prev[tick.coin] ? [...prev[tick.coin]] : [];
            arr.push({ t, p: tick.price });
            if (arr.length > 240) arr.shift();
            return { ...prev, [tick.coin]: arr };
          });
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects; we just reflect the state
    };

    return () => es.close();
  }, []);

  // ----- 24h change via server's cached endpoint -----
  useEffect(() => {
    let cancelled = false;

    async function fetch24h() {
      try {
        const res = await fetch("/api/change-24h");
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, { change24h: number }>;
        if (cancelled) return;
        setPrices((prev) => {
          const next = { ...prev };
          for (const [coin, v] of Object.entries(data)) {
            next[coin] = { ...(next[coin] ?? { price: 0 }), change24h: v.change24h };
          }
          return next;
        });
      } catch {
        /* non-fatal */
      }
    }

    fetch24h();
    const id = setInterval(fetch24h, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ----- Clock for countdowns -----
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // ----- Settle bets whenever prices update -----
  const pricesRef = useRef(prices);
  pricesRef.current = prices;

  useEffect(() => {
    if (!activeBets.length) return;

    const t = Date.now();
    const stillActive: Bet[] = [];
    const newlySettled: SettledBet[] = [];
    let balanceDelta = 0;

    for (const bet of activeBets) {
      const cur = prices[bet.coinId]?.price;
      if (cur == null) {
        stillActive.push(bet);
        continue;
      }

      if (bet.type === "quick") {
        if (t >= bet.expiresAt) {
          const won = bet.direction === "up" ? cur > bet.entryPrice : cur < bet.entryPrice;
          const payout = won ? bet.stake * 2 : 0;
          balanceDelta += payout;
          newlySettled.push({ ...bet, exitPrice: cur, won, payout, settledAt: t });
        } else {
          stillActive.push(bet);
        }
      } else {
        const hit = bet.direction === "above" ? cur >= bet.target : cur <= bet.target;
        if (hit) {
          const payout = bet.stake * bet.multiplier;
          balanceDelta += payout;
          newlySettled.push({ ...bet, exitPrice: cur, won: true, payout, settledAt: t });
        } else if (t >= bet.expiresAt) {
          newlySettled.push({ ...bet, exitPrice: cur, won: false, payout: 0, settledAt: t });
        } else {
          stillActive.push(bet);
        }
      }
    }

    if (newlySettled.length) {
      setActiveBets(stillActive);
      setSettled((s) => [...newlySettled, ...s].slice(0, 50));
      if (balanceDelta) setBalance((b) => b + balanceDelta);
      const last = newlySettled[newlySettled.length - 1];
      const coin = COIN_BY_ID[last.coinId];
      setToast({
        kind: last.won ? "win" : "loss",
        msg: last.won
          ? `Won ${fmtUSD(last.payout - last.stake)} on ${coin.sym}`
          : `Lost ${fmtUSD(last.stake)} on ${coin.sym}`,
      });
      setTimeout(() => setToast(null), 3000);
    }
  }, [prices, activeBets]);

  // ----- Bet placement -----
  function placeQuick(direction: "up" | "down", stake: number) {
    const p = prices[selected]?.price;
    if (!p || stake <= 0 || stake > balance) return;
    const bet: QuickBet = {
      id: Math.random().toString(36).slice(2),
      type: "quick",
      coinId: selected,
      direction,
      stake,
      entryPrice: p,
      createdAt: Date.now(),
      expiresAt: Date.now() + ROUND_SECONDS * 1000,
    };
    setBalance((b) => b - stake);
    setActiveBets((a) => [...a, bet]);
  }

  function placeTarget(opts: {
    direction: "above" | "below";
    target: number;
    minutes: number;
    stake: number;
  }) {
    const { direction, target, minutes, stake } = opts;
    const p = prices[selected]?.price;
    if (!p || stake <= 0 || stake > balance) return;
    if (direction === "above" && target <= p) return;
    if (direction === "below" && target >= p) return;

    const pctMove = Math.abs((target - p) / p) * 100;
    const timeFactor = Math.max(0.25, minutes / 10);
    const rawMult = 1 + (pctMove / timeFactor) * 2;
    const multiplier = Math.min(50, Math.max(1.2, Number(rawMult.toFixed(2))));

    const bet: TargetBet = {
      id: Math.random().toString(36).slice(2),
      type: "target",
      coinId: selected,
      direction,
      stake,
      target,
      entryPrice: p,
      multiplier,
      createdAt: Date.now(),
      expiresAt: Date.now() + minutes * 60 * 1000,
    };
    setBalance((b) => b - stake);
    setActiveBets((a) => [...a, bet]);
  }

  const coin = COIN_BY_ID[selected];
  const selectedPrice = prices[selected]?.price;
  const selectedChg = prices[selected]?.change24h;
  const lastUpdate = prices[selected]?.updatedAt;

  return (
    <div className="min-h-screen w-full text-stone-900">
      {/* Header */}
      <header className="border-b border-stone-200/80 bg-white/70 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-stone-900 flex items-center justify-center">
              <Zap size={15} className="text-amber-300" strokeWidth={2.5} />
            </div>
            <span
              className="text-xl tracking-tight font-semibold"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              pumpmarket
            </span>
            <span className="ml-2 text-[10px] uppercase tracking-widest text-stone-400 border border-stone-200 rounded-full px-2 py-0.5">
              Paper Trading
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-stone-500">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? "bg-emerald-500" : "bg-amber-400"
                } animate-pulse`}
              />
              {connected ? "Live from Pyth" : "Connecting…"}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-900 text-white">
              <Wallet size={14} />
              <span className="text-sm font-medium tabular-nums">{fmtUSD(balance)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Market ticker */}
      <div className="border-b border-stone-200/80 bg-white overflow-x-auto">
        <div className="max-w-7xl mx-auto px-6 flex">
          {COINS.map((c) => {
            const p = prices[c.id]?.price;
            const ch = prices[c.id]?.change24h ?? 0;
            const active = c.id === selected;
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`flex-shrink-0 px-4 py-3 border-r border-stone-100 text-left transition-colors ${
                  active ? "bg-stone-50" : "hover:bg-stone-50/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] font-semibold tracking-wide ${
                      active ? "text-stone-900" : "text-stone-500"
                    }`}
                  >
                    {c.sym}
                  </span>
                  <span
                    className={`text-[10px] tabular-nums ${
                      ch >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {fmtPct(ch)}
                  </span>
                </div>
                <div className="text-sm font-medium tabular-nums mt-0.5">{fmtUSD(p)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="md:col-span-2 bg-white border border-stone-200 rounded-2xl p-4 sm:p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-4xl" style={{ fontFamily: "var(--font-serif)" }}>
                  {coin.name}
                </span>
                <span className="text-xs uppercase tracking-[0.2em] text-stone-400 mt-2">
                  {coin.sym} / USD
                </span>
              </div>
              <div className="flex items-baseline gap-3 mt-2">
                <span className="text-3xl font-semibold tabular-nums">
                  {fmtUSD(selectedPrice)}
                </span>
                <span
                  className={`text-sm tabular-nums font-medium ${
                    (selectedChg ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {fmtPct(selectedChg ?? 0)}{" "}
                  <span className="text-stone-400 font-normal">24h</span>
                </span>
              </div>
            </div>
            <div className="text-right text-xs text-stone-400 space-y-1">
              <div>
                Updated {lastUpdate ? Math.floor((now - lastUpdate) / 1000) : "?"}s ago
              </div>
              <div className="font-mono text-stone-300">Pyth Network • ~400ms</div>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2 sm:gap-3 items-stretch">
            <Sparkline points={history[selected] ?? []} />
            <InlineQuickActions
              stake={quickStake}
              balance={balance}
              disabled={!selectedPrice}
              onPlace={placeQuick}
            />
          </div>
        </div>

        {/* Prediction panel — sits next to the chart on md+, immediately after the chart on mobile */}
        <aside className="md:col-span-1 md:row-span-3 md:row-start-1 md:col-start-3">
          <div className="sticky top-24">
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              <div className="flex border-b border-stone-200">
                <TabButton active={tab === "quick"} onClick={() => setTab("quick")}>
                  <Clock size={14} /> Quick 60s
                </TabButton>
                <TabButton active={tab === "target"} onClick={() => setTab("target")}>
                  <Target size={14} /> Price target
                </TabButton>
              </div>

              {tab === "quick" ? (
                <QuickBetForm
                  coin={coin}
                  price={selectedPrice}
                  balance={balance}
                  stake={quickStake}
                  setStake={setQuickStake}
                />
              ) : (
                <TargetBetForm
                  coin={coin}
                  price={selectedPrice}
                  balance={balance}
                  onPlace={placeTarget}
                />
              )}
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-stone-400 px-1">
              Simulation only. Live prices streamed from Pyth Network via a
              server-side SSE proxy. 120+ institutional publishers, ~400ms
              updates. 24h change via CoinGecko.
            </p>
          </div>
        </aside>

        {/* Open positions */}
        <div className="md:col-span-2 md:col-start-1 bg-white border border-stone-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Activity size={16} />
              Open positions
              <span className="text-xs text-stone-400 font-normal">
                ({activeBets.length})
              </span>
            </h2>
          </div>
          {activeBets.length === 0 ? (
            <div className="text-sm text-stone-400 py-8 text-center border border-dashed border-stone-200 rounded-xl">
              No open positions. Place a prediction to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {activeBets.map((bet) => (
                <PositionRow key={bet.id} bet={bet} prices={prices} now={now} />
              ))}
            </div>
          )}
        </div>

        {/* Settled history */}
        <div className="md:col-span-2 md:col-start-1 bg-white border border-stone-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Trophy size={16} />
              History
            </h2>
            <div className="flex gap-4 text-xs text-stone-500">
              <span>
                Wins:{" "}
                <b className="text-emerald-600 tabular-nums">
                  {settled.filter((b) => b.won).length}
                </b>
              </span>
              <span>
                Losses:{" "}
                <b className="text-rose-600 tabular-nums">
                  {settled.filter((b) => !b.won).length}
                </b>
              </span>
            </div>
          </div>
          {settled.length === 0 ? (
            <div className="text-sm text-stone-400 py-6 text-center">
              No settled bets yet.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {settled.map((bet) => (
                <SettledRow key={bet.id} bet={bet} />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-40 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 ${
            toast.kind === "win"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
          style={{ animation: "slideIn 0.3s ease-out" }}
        >
          {toast.kind === "win" ? <Check size={16} /> : <X size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
        active
          ? "bg-white text-stone-900 border-b-2 border-stone-900 -mb-px"
          : "text-stone-500 hover:text-stone-700 bg-stone-50/50"
      }`}
    >
      {children}
    </button>
  );
}

function QuickBetForm({
  coin,
  price,
  balance,
  stake,
  setStake,
}: {
  coin: Coin;
  price: number | undefined;
  balance: number;
  stake: number;
  setStake: (stake: number) => void;
}) {
  const chips = [25, 100, 500, 1000];

  return (
    <div className="p-5 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-1">
          Predicting
        </div>
        <div className="flex items-baseline justify-between">
          <div className="font-medium">{coin.sym} in 60 seconds</div>
          <div className="text-xs text-stone-500 tabular-nums">@ {fmtUSD(price)}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-2">Stake</div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">
            $
          </span>
          <input
            type="number"
            value={stake}
            min={1}
            max={balance}
            onChange={(e) => setStake(Number(e.target.value))}
            className="w-full pl-7 pr-3 py-2.5 border border-stone-200 rounded-lg text-sm tabular-nums font-medium focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
          />
        </div>
        <div className="flex gap-1.5 mt-2">
          {chips.map((v) => (
            <button
              key={v}
              onClick={() => setStake(Math.min(v, balance))}
              className="flex-1 text-xs py-1.5 rounded-md border border-stone-200 hover:border-stone-400 hover:bg-stone-50 tabular-nums text-stone-600"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-stone-400 text-center">
        Use the chart-side UP/DOWN buttons to place this stake instantly.
      </div>
    </div>
  );
}

function InlineQuickActions({
  stake,
  balance,
  disabled,
  onPlace,
}: {
  stake: number;
  balance: number;
  disabled: boolean;
  onPlace: (direction: "up" | "down", stake: number) => void;
}) {
  const isDisabled = disabled || stake <= 0 || stake > balance;
  return (
    <div className="sticky top-20 self-start rounded-xl border border-stone-200 p-1.5 bg-stone-50 flex flex-col gap-1.5 justify-between">
      <button
        onClick={() => onPlace("up", stake)}
        disabled={isDisabled}
        className="group relative py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-stone-200 disabled:cursor-not-allowed text-white font-semibold flex flex-col items-center transition-colors"
      >
        <TrendingUp size={16} />
        <span className="text-xs mt-0.5">UP</span>
        <span className="text-[10px] opacity-80">2.00×</span>
      </button>
      <button
        onClick={() => onPlace("down", stake)}
        disabled={isDisabled}
        className="group relative py-2.5 rounded-lg bg-rose-500 hover:bg-rose-600 disabled:bg-stone-200 disabled:cursor-not-allowed text-white font-semibold flex flex-col items-center transition-colors"
      >
        <TrendingDown size={16} />
        <span className="text-xs mt-0.5">DOWN</span>
        <span className="text-[10px] opacity-80">2.00×</span>
      </button>
    </div>
  );
}

function TargetBetForm({
  coin,
  price,
  balance,
  onPlace,
}: {
  coin: Coin;
  price: number | undefined;
  balance: number;
  onPlace: (opts: {
    direction: "above" | "below";
    target: number;
    minutes: number;
    stake: number;
  }) => void;
}) {
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [targetStr, setTargetStr] = useState("");
  const [minutes, setMinutes] = useState(5);
  const [stake, setStake] = useState(100);

  useEffect(() => {
    if (price) {
      const delta = direction === "above" ? 1.01 : 0.99;
      setTargetStr((price * delta).toFixed(price > 100 ? 0 : 4));
    }
  }, [coin.id, direction, price]);

  const target = Number(targetStr);
  const valid =
    !!price &&
    target > 0 &&
    ((direction === "above" && target > price) ||
      (direction === "below" && target < price)) &&
    stake > 0 &&
    stake <= balance;

  let multiplier: number | null = null;
  if (valid && price) {
    const pctMove = Math.abs((target - price) / price) * 100;
    const timeFactor = Math.max(0.25, minutes / 10);
    const raw = 1 + (pctMove / timeFactor) * 2;
    multiplier = Math.min(50, Math.max(1.2, Number(raw.toFixed(2))));
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-1">
          Predicting
        </div>
        <div className="flex items-baseline justify-between">
          <div className="font-medium">{coin.sym} hits a target</div>
          <div className="text-xs text-stone-500 tabular-nums">@ {fmtUSD(price)}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-2">
          Direction
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDirection("above")}
            className={`py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 ${
              direction === "above"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-stone-200 text-stone-500 hover:border-stone-300"
            }`}
          >
            <TrendingUp size={14} /> Above
          </button>
          <button
            onClick={() => setDirection("below")}
            className={`py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 ${
              direction === "below"
                ? "border-rose-500 bg-rose-50 text-rose-700"
                : "border-stone-200 text-stone-500 hover:border-stone-300"
            }`}
          >
            <TrendingDown size={14} /> Below
          </button>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-2">
          Target price
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">
            $
          </span>
          <input
            type="number"
            value={targetStr}
            onChange={(e) => setTargetStr(e.target.value)}
            className="w-full pl-7 pr-3 py-2.5 border border-stone-200 rounded-lg text-sm tabular-nums font-medium focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
          />
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-2">
          Window <span className="text-stone-900 font-semibold">{minutes}m</span>
        </div>
        <input
          type="range"
          min={1}
          max={30}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="w-full accent-stone-900"
        />
        <div className="flex justify-between text-[10px] text-stone-400 mt-1">
          <span>1m</span>
          <span>15m</span>
          <span>30m</span>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest text-stone-400 mb-2">Stake</div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">
            $
          </span>
          <input
            type="number"
            value={stake}
            min={1}
            max={balance}
            onChange={(e) => setStake(Number(e.target.value))}
            className="w-full pl-7 pr-3 py-2.5 border border-stone-200 rounded-lg text-sm tabular-nums font-medium focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
          />
        </div>
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-1 text-xs">
        <Row
          label="Multiplier"
          value={multiplier ? `${multiplier.toFixed(2)}×` : "—"}
        />
        <Row
          label="Potential payout"
          value={multiplier ? fmtUSD(stake * multiplier) : "—"}
        />
        <Row
          label="Potential profit"
          value={multiplier ? fmtUSD(stake * multiplier - stake) : "—"}
          highlight
        />
      </div>

      <button
        onClick={() => onPlace({ direction, target, minutes, stake })}
        disabled={!valid}
        className="w-full py-3 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
      >
        Place prediction <ChevronRight size={16} />
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-500">{label}</span>
      <span
        className={`tabular-nums font-medium ${
          highlight ? "text-emerald-600" : "text-stone-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function PositionRow({
  bet,
  prices,
  now,
}: {
  bet: Bet;
  prices: Record<string, PriceInfo>;
  now: number;
}) {
  const coin = COIN_BY_ID[bet.coinId];
  const cur = prices[bet.coinId]?.price;
  const remaining = Math.max(0, bet.expiresAt - now);
  const secs = Math.ceil(remaining / 1000);

  let winning = false;
  let subtitle = "";

  if (bet.type === "quick") {
    winning = cur != null && (bet.direction === "up" ? cur > bet.entryPrice : cur < bet.entryPrice);
    subtitle = `${bet.direction.toUpperCase()} from ${fmtUSD(bet.entryPrice)} → now ${fmtUSD(cur)}`;
  } else {
    const dist = cur != null ? (bet.direction === "above" ? bet.target - cur : cur - bet.target) : Infinity;
    winning = dist <= 0;
    subtitle = `Target ${bet.direction} ${fmtUSD(bet.target)} • now ${fmtUSD(cur)}`;
  }

  const duration = bet.expiresAt - bet.createdAt;
  const progress = duration > 0 ? 1 - remaining / duration : 0;

  return (
    <div className="border border-stone-200 rounded-xl p-3 relative overflow-hidden">
      <div
        className={`absolute left-0 top-0 h-full ${
          winning ? "bg-emerald-50" : "bg-rose-50"
        } transition-all`}
        style={{ width: `${progress * 100}%`, opacity: 0.6 }}
      />
      <div className="relative flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{coin.sym}</span>
            <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
              {bet.type === "quick" ? "60s" : "Target"}
            </span>
            {bet.type === "target" && (
              <span className="text-[10px] tabular-nums text-stone-500">
                {bet.multiplier.toFixed(2)}×
              </span>
            )}
          </div>
          <div className="text-xs text-stone-500 mt-0.5 tabular-nums">{subtitle}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{fmtUSD(bet.stake)}</div>
          <div
            className={`text-[11px] tabular-nums ${
              winning ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {secs}s • {winning ? "winning" : "losing"}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettledRow({ bet }: { bet: SettledBet }) {
  const coin = COIN_BY_ID[bet.coinId];
  return (
    <div className="flex items-center justify-between py-2 border-b border-stone-100 last:border-b-0 text-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            bet.won ? "bg-emerald-500" : "bg-rose-400"
          }`}
        />
        <span className="font-medium flex-shrink-0">{coin.sym}</span>
        <span className="text-xs text-stone-500 truncate">
          {bet.type === "quick"
            ? `${bet.direction.toUpperCase()} • ${fmtUSD(bet.entryPrice)} → ${fmtUSD(bet.exitPrice)}`
            : `${bet.direction} ${fmtUSD(bet.target)} • ended ${fmtUSD(bet.exitPrice)}`}
        </span>
      </div>
      <div
        className={`tabular-nums font-semibold text-sm flex-shrink-0 ml-3 ${
          bet.won ? "text-emerald-600" : "text-stone-400"
        }`}
      >
        {bet.won ? "+" : "−"}
        {fmtUSD(bet.won ? bet.payout - bet.stake : bet.stake)}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { t: number; p: number }[] }) {
  if (!points || points.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-stone-400">
        Gathering price data…
      </div>
    );
  }

  const w = 800;
  const h = 180;
  const pad = 8;

  const ps = points.map((p) => p.p);
  const min = Math.min(...ps);
  const max = Math.max(...ps);
  const range = max - min || 1;

  const xStep = (w - pad * 2) / (points.length - 1);
  const coords = points.map((pt, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (pt.p - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const area = `${path} L ${coords[coords.length - 1][0]} ${h - pad} L ${coords[0][0]} ${h - pad} Z`;

  const rising = points[points.length - 1].p >= points[0].p;
  const stroke = rising ? "#059669" : "#e11d48";
  const fill = rising ? "#059669" : "#e11d48";

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48">
        <defs>
          <linearGradient id="area-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity="0.15" />
            <stop offset="100%" stopColor={fill} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={w - pad}
            y1={pad + f * (h - pad * 2)}
            y2={pad + f * (h - pad * 2)}
            stroke="#f5f5f4"
            strokeWidth="1"
          />
        ))}
        <path d={area} fill="url(#area-grad)" />
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={coords[coords.length - 1][0]}
          cy={coords[coords.length - 1][1]}
          r="4"
          fill={stroke}
        />
        <circle
          cx={coords[coords.length - 1][0]}
          cy={coords[coords.length - 1][1]}
          r="8"
          fill={stroke}
          opacity="0.2"
        >
          <animate attributeName="r" from="4" to="12" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite" />
        </circle>
      </svg>
      <div className="absolute top-1 right-2 text-[10px] text-stone-400 tabular-nums">
        hi {fmtUSD(max)} · lo {fmtUSD(min)}
      </div>
    </div>
  );
}
