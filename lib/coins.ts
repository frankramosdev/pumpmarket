// Pyth Network price feed IDs (mainnet, stable channel)
// Source: https://www.pyth.network/developers/price-feed-ids
// Verified live against https://hermes.pyth.network/v2/price_feeds

export type Coin = {
  id: string;
  sym: string;
  name: string;
  feed: string; // Pyth feed ID (no 0x prefix)
};

export const COINS: Coin[] = [
  { id: "BTC",  sym: "BTC",  name: "Bitcoin",  feed: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  { id: "ETH",  sym: "ETH",  name: "Ethereum", feed: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  { id: "USDT", sym: "USDT", name: "Tether",   feed: "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b" },
  { id: "BNB",  sym: "BNB",  name: "BNB",      feed: "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f" },
  { id: "SOL",  sym: "SOL",  name: "Solana",   feed: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  { id: "XRP",  sym: "XRP",  name: "XRP",      feed: "ec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8" },
  { id: "USDC", sym: "USDC", name: "USD Coin", feed: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
  { id: "DOGE", sym: "DOGE", name: "Dogecoin", feed: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c" },
  { id: "ADA",  sym: "ADA",  name: "Cardano",  feed: "2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d" },
  { id: "TRX",  sym: "TRX",  name: "TRON",     feed: "67aed5a24fdad045475e7195c98a98aea119c763f272d4523f5bac93a4f33c2b" },
];

export const FEED_TO_COIN: Record<string, string> = Object.fromEntries(
  COINS.map(c => [c.feed, c.id])
);

export const COIN_BY_ID: Record<string, Coin> = Object.fromEntries(
  COINS.map(c => [c.id, c])
);

// CoinGecko IDs for 24h change data (Pyth doesn't provide this)
export const CG_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binancecoin",
  SOL: "solana",  XRP: "ripple",   USDC: "usd-coin", DOGE: "dogecoin",
  ADA: "cardano", TRX: "tron",
};

export const HERMES_URL = "https://hermes.pyth.network";

// The normalized event format our server emits to clients
export type PriceTick = {
  coin: string;
  price: number;
  publishTime: number;
};
