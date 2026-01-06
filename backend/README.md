# PanchoPolyBot Execution Engine

## 🚀 Setup Guide

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Create Configuration**
   Create a file named `.env` in the `backend` folder. Paste the following content and fill in your keys:

   ```env
   # WALLET
   PRIVATE_KEY=your_polygon_wallet_private_key_here

   # POLYMARKET API (Get from polymarket.com/settings)
   POLY_API_KEY=your_api_key
   POLY_API_SECRET=your_api_secret
   POLY_PASSPHRASE=your_passphrase

   # STRATEGY SETTINGS
   # The markets you want to trade (Comma separated slugs)
   MARKET_SLUG=bitcoin-up-or-down-january-6-2026-400pm-415pm-et
   
   # Bot looks for price discrepancies here
   BINANCE_SYMBOL=btcusdt
   
   # How much to bet per trade in USDC
   BET_SIZE_USDC=10
   
   # Only buy if token price is CHEAPER than this (0.95 = 95 cents)
   MAX_ENTRY_PRICE=0.95
   
   # Only bet if BTC has moved at least this much from the start price (Avoids 50/50 flips)
   MIN_PRICE_DELTA=5.0
   
   # RPC
   POLYGON_RPC_URL=https://polygon-rpc.com
   ```

3. **Run the Bot**
   ```bash
   node bot.js
   ```

## ⚠️ Risk Warning
This bot executes real trades with real money. Ensure you have USDC and MATIC (for gas, though usually gasless) in your Polygon wallet.
