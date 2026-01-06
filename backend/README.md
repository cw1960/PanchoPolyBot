# PanchoPolyBot Execution Engine

## 🚀 Tokyo/Global Server Setup Guide

1. **Connect to Server**
   ```bash
   ssh root@<YOUR_SERVER_IP>
   ```

2. **Install Node.js & Tools**
   ```bash
   apt update && apt upgrade -y
   curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
   apt install -y nodejs
   ```

3. **Setup Folder**
   ```bash
   mkdir pancho-bot
   cd pancho-bot
   ```

4. **Create Files**
   - Create `package.json`
   - Create `bot.js`
   - Create `.env`

5. **Start (Testing Mode)**
   ```bash
   npm install
   npm start
   ```

---

## 🔑 .env Configuration

Create a `.env` file with the following. 

**IMPORTANT:** Find the `MARKET_SLUG` by looking at the Polymarket URL.
*   URL: `polymarket.com/event/bitcoin-price-above-100k-jan-2025`
*   Slug: `bitcoin-price-above-100k-jan-2025`

```env
PRIVATE_KEY=your_private_key_here
POLY_API_KEY=your_api_key_here
POLY_API_SECRET=your_secret_here
POLY_PASSPHRASE=your_passphrase_here

MARKET_SLUG=bitcoin-price-above-100k-jan-2025
BINANCE_SYMBOL=btcusdt
BET_SIZE_USDC=10
```

---

## 🌙 Keep it Running 24/7 (Production Mode)

1. **Install PM2**
   ```bash
   npm install -g pm2
   ```

2. **Start the Bot**
   ```bash
   pm2 start bot.js --name pancho
   ```

3. **Monitor**
   ```bash
   pm2 monit
   ```
