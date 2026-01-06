require('dotenv').config();
const WebSocket = require('ws');
const { ethers } = require('ethers');
const { ClobClient, Side } = require('@polymarket/clob-client');
const chalk = require('chalk');
const axios = require('axios');

// DEBUG: Print location
console.log(chalk.cyan(`> DEBUG: Running in directory: ${process.cwd()}`));

// CONFIGURATION
const CONFIG = {
    maxEntryPrice: parseFloat(process.env.MAX_ENTRY_PRICE || '0.95'),
    minPriceDelta: parseFloat(process.env.MIN_PRICE_DELTA || '5.0'), 
    betSizeUSDC: parseFloat(process.env.BET_SIZE_USDC || '10'),
    binanceSymbol: process.env.BINANCE_SYMBOL || 'btcusdt',
    marketSlugs: (process.env.MARKET_SLUG || '').split(',').map(s => s.trim()).filter(s => s),
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
};

// VALIDATION
const hasKey = !!process.env.PRIVATE_KEY;
const hasApiKey = !!process.env.POLY_API_KEY;

if (!hasKey || !hasApiKey) {
    console.error(chalk.red('FATAL: Missing credentials in .env file.'));
    process.exit(1);
}

// State
let activeMarkets = []; 
let isProcessing = false;
let ticks = 0;

console.log(chalk.green(`> PANCHOPOLYBOT: BINARY OPTION ENGINE (UP/DOWN) v2.2 (PATCHED)`));

const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const clobClient = new ClobClient(
    'https://clob.polymarket.com/', 
    137, 
    wallet, 
    {
        apiKey: process.env.POLY_API_KEY,
        apiSecret: process.env.POLY_API_SECRET,
        apiPassphrase: process.env.POLY_PASSPHRASE
    }
);

// HELPER: Get historical candle
async function getBinanceOpenPrice(timestampMs) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${CONFIG.binanceSymbol.toUpperCase()}&interval=1m&startTime=${timestampMs}&limit=1`;
        const res = await axios.get(url);
        if (res.data && res.data.length > 0) {
            return parseFloat(res.data[0][1]); // [1] is 'Open' price
        }
    } catch (e) {
        console.error(chalk.red(`> Failed to fetch historical start price: ${e.message}`));
    }
    return null;
}

// 1. DISCOVERY PHASE
async function resolveMarkets(slugs) {
    console.log(chalk.yellow(`> Resolving ${slugs.length} Up/Down Markets...`));
    
    for (const slug of slugs) {
        try {
            const response = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
            if (response.data.length === 0) {
                console.error(chalk.red(`> Market not found: ${slug}`));
                continue;
            }

            const market = response.data[0].markets[0];
            let upTokenId = null;
            let downTokenId = null;
            
            // CRITICAL FIX: Parse clobTokenIds if it's a string
            let tokenIds = market.clobTokenIds;
            if (typeof tokenIds === 'string') {
                try {
                    tokenIds = JSON.parse(tokenIds);
                } catch(e) {
                    console.error(chalk.red(`> Error parsing clobTokenIds for ${slug}`));
                    continue;
                }
            }
            
            const outcomes = JSON.parse(market.outcomes);
            outcomes.forEach((outcomeName, index) => {
                const name = outcomeName.toUpperCase();
                if (name === 'UP') upTokenId = tokenIds[index];
                if (name === 'DOWN') downTokenId = tokenIds[index];
            });

            if (!upTokenId || !downTokenId) {
                console.warn(chalk.red(`> Skipped ${slug}: Could not map UP/DOWN. IDs found: ${JSON.stringify(tokenIds)}`));
                continue;
            }
            
            // Start Date Check
            const startDate = new Date(market.startDate);
            const startTs = startDate.getTime();

            console.log(chalk.blue(`> Fetching Reference Price for ${slug}...`));
            let referencePrice = await getBinanceOpenPrice(startTs);
            
            // If strictly in future, wait (or use current price for testing)
            if (Date.now() < startTs) {
                console.log(chalk.gray(`> Market ${slug} hasn't started yet. Waiting...`));
                // For live testing, you might want to uncomment this to just use current price:
                // referencePrice = referencePrice || 98000; 
                continue;
            }

            if (!referencePrice) {
                 console.warn(chalk.red(`> Could not find reference price for ${slug}. Skipping.`));
                 continue;
            }
            
            console.log(chalk.green(`> LOCKED: ${slug}`));
            console.log(chalk.green(`  Ref Price: $${referencePrice}`));
            console.log(chalk.green(`  UP ID:   ${upTokenId}`));
            console.log(chalk.green(`  DOWN ID: ${downTokenId}`));
            
            activeMarkets.push({
                slug: slug,
                upId: upTokenId,
                downId: downTokenId,
                referencePrice: referencePrice,
                lastTrade: 0
            });
            
        } catch (e) {
            console.error(chalk.red(`> Error resolving ${slug}: ${e.message}`));
        }
    }

    if (activeMarkets.length === 0) {
        console.error(chalk.red('> No active markets ready. Exiting.'));
        process.exit(1);
    }
    
    console.log(chalk.blue(`> Engine Ready. Connecting to Binance Stream...`));
    startTrading();
}

// 2. EXECUTION PHASE
function startTrading() {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${CONFIG.binanceSymbol}@trade`);

    ws.on('open', () => console.log(chalk.blue('> WebSocket Connected.')));

    setInterval(() => {
        if (activeMarkets.length > 0) {
            process.stdout.write(chalk.gray(`\r> [HEARTBEAT] Scanning ${activeMarkets.length} mkts | Ticks: ${ticks}   `));
        }
    }, 5000);

    ws.on('message', async (data) => {
        ticks++;
        if (isProcessing) return;
        isProcessing = true;
        try {
            const trade = JSON.parse(data);
            const spotPrice = parseFloat(trade.p);
            await checkArbitrage(spotPrice);
        } catch (e) { console.error(e); }
        isProcessing = false;
    });

    ws.on('close', () => {
        console.log(chalk.yellow('\n> WebSocket disconnected. Reconnecting...'));
        setTimeout(startTrading, 2000);
    });

    ws.on('error', (err) => {
        console.error(chalk.red('\n> WebSocket Error:', err.message));
        ws.terminate();
    });
}

async function checkArbitrage(spotPrice) {
    const promises = activeMarkets.map(async (market) => {
        if (Date.now() - market.lastTrade < 5000) return;

        const delta = spotPrice - market.referencePrice;
        const absDelta = Math.abs(delta);

        if (absDelta < CONFIG.minPriceDelta) return;

        const winningTokenId = delta > 0 ? market.upId : market.downId;
        const direction = delta > 0 ? "UP" : "DOWN";

        // SAFETY: Do not query if ID is invalid
        if (!winningTokenId || winningTokenId.length < 10) return;

        try {
            const orderbook = await clobClient.getOrderBook(winningTokenId);
            if (!orderbook.asks || orderbook.asks.length === 0) return;

            const bestAsk = parseFloat(orderbook.asks[0].price);
            
            // LOGIC: If price moved UP, we expect UP shares to be expensive. 
            // If they are still cheap (below maxEntryPrice), we buy.
            if (bestAsk <= CONFIG.maxEntryPrice) {
                console.log(chalk.bgGreen.black(`\n SNIPE SIGNAL `));
                console.log(`Delta: ${delta.toFixed(2)} | Target: ${direction} | Price: ${bestAsk}`);
                await executeTrade(market, winningTokenId, bestAsk, direction);
            }
        } catch (err) { 
            // Suppress 404s to avoid log spam, only print others
            if (!err.message.includes('404')) {
                console.error(chalk.red(`\n> Orderbook Error: ${err.message}`));
            }
        }
    });
    await Promise.all(promises);
}

async function executeTrade(market, tokenId, price, direction) {
    console.log(chalk.yellow(`> EXECUTING ${direction} ORDER...`));
    market.lastTrade = Date.now();
    
    try {
        const rawSize = CONFIG.betSizeUSDC / price;
        const size = Math.floor(rawSize * 100) / 100; 

        const order = await clobClient.createOrder({
            tokenID: tokenId,
            price: price, 
            side: Side.BUY,
            size: size,
            feeRateBps: 0,
            nonce: Date.now(),
        });

        const resp = await clobClient.postOrder(order);
        console.log(chalk.green(`> ORDER SUBMITTED: ${resp.orderID}`));
        
    } catch (e) {
        console.error(chalk.red(`> TRADE FAILED: ${e.message}`));
    }
}

resolveMarkets(CONFIG.marketSlugs);