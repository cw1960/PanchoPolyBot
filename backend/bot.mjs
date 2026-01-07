import dotenv from 'dotenv';
dotenv.config();

// @ts-ignore
import WebSocket, { WebSocketServer } from 'ws';
import { ethers } from 'ethers';
import { ClobClient, Side } from '@polymarket/clob-client';
import chalk from 'chalk';
import axios from 'axios';
import process from 'process';

// --- VERSION CHECK ---
const VERSION = "v6.14 (PURE ID MODE)";
console.log(chalk.bgBlue.white.bold(`\n------------------------------------------------`));
console.log(chalk.bgBlue.white.bold(` PANCHOPOLYBOT: ${VERSION} `));
console.log(chalk.bgBlue.white.bold(` UI SERVER: ENABLED (Port 8080)                 `));
console.log(chalk.bgBlue.white.bold(`------------------------------------------------\n`));

// --- CONFIGURATION ---
const CONFIG = {
    maxEntryPrice: parseFloat(process.env.MAX_ENTRY_PRICE || '0.95'),
    minPriceDelta: parseFloat(process.env.MIN_PRICE_DELTA || '5.0'), 
    betSizeUSDC: parseFloat(process.env.BET_SIZE_USDC || '10'),
    binanceSymbol: process.env.BINANCE_SYMBOL || 'btcusdt',
    // Default slug (likely closed, will force idle state)
    marketSlugs: ['bitcoin-up-or-down-january-7-2am-et'],
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
};

// --- VALIDATION ---
const pKey = process.env.PRIVATE_KEY || "";
const apiKey = process.env.POLY_API_KEY || "";

if (!pKey || !apiKey || pKey.includes("your_polygon_wallet")) {
    console.error(chalk.bgRed.white('\n FATAL ERROR: CREDENTIALS MISSING \n'));
    process.exit(1);
}

// --- STATE ---
let activeMarkets = []; 
let isProcessing = false;
let ticks = 0;
let binanceWs = null; 

// --- UI SERVER SETUP ---
const WSS_PORT = 8080;
const wss = new WebSocketServer({ port: WSS_PORT });
console.log(chalk.magenta(`> UI SERVER: Listening on ws://localhost:${WSS_PORT}`));

wss.on('connection', (ws) => {
    // 1. IMMEDIATE SYNC: Send current state to new client so they don't see "Idle"
    if (activeMarkets.length > 0) {
         const m = activeMarkets[0];
         ws.send(JSON.stringify({
            type: 'MARKET_LOCKED',
            timestamp: Date.now(),
            payload: {
                slug: m.slug,
                referencePrice: m.referencePrice,
                upId: m.upId,
                downId: m.downId
            }
        }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // --- UPDATE CONFIG HANDLER ---
            if (data.type === 'UPDATE_CONFIG') {
                const { slug, betSize, maxEntryPrice, minPriceDelta, referencePrice } = data.payload;
                
                // 1. Update Strategy Parameters
                if (betSize !== undefined) CONFIG.betSizeUSDC = parseFloat(betSize);
                if (maxEntryPrice !== undefined) CONFIG.maxEntryPrice = parseFloat(maxEntryPrice);
                if (minPriceDelta !== undefined) CONFIG.minPriceDelta = parseFloat(minPriceDelta);

                // Receive RAW slug/id
                const rawSlug = slug;
                const newRefPrice = referencePrice ? parseFloat(referencePrice) : null;
                
                console.log(chalk.magenta(`\n> UI CONFIG UPDATE:`));
                console.log(chalk.dim(`  Bet Size: $${CONFIG.betSizeUSDC}`));
                console.log(chalk.dim(`  Max Entry: $${CONFIG.maxEntryPrice}`));
                console.log(chalk.dim(`  Min Delta: $${CONFIG.minPriceDelta}`));

                // 2. Handle Ref Price Override
                if (newRefPrice && activeMarkets.length > 0) {
                    activeMarkets[0].referencePrice = newRefPrice;
                }

                // 3. Resolve New Market (Always resolve if slug/id is sent)
                if (rawSlug) {
                     console.log(chalk.magenta(`  Processing Input: ${rawSlug}`));
                     broadcast('LOG', { message: `Reconfiguring for ${rawSlug}...` });
                     
                     // Reset state
                     activeMarkets = [];
                     CONFIG.marketSlugs = [rawSlug];
                     await resolveMarkets(CONFIG.marketSlugs);
                     
                     // Re-apply ref price override if one was sent and successful resolve
                     if (newRefPrice && activeMarkets.length > 0) {
                         activeMarkets[0].referencePrice = newRefPrice;
                          broadcast('MARKET_LOCKED', {
                            slug: activeMarkets[0].slug,
                            referencePrice: newRefPrice,
                            upId: activeMarkets[0].upId,
                            downId: activeMarkets[0].downId
                        });
                     }
                }
            }
        } catch (e) {
            console.error('Error handling UI command:', e);
        }
    });
});

function broadcast(type, payload) {
    const message = JSON.stringify({ type, timestamp: Date.now(), payload });
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(message);
        }
    });
}

// --- POLYMARKET SETUP ---
const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
// Cast wallet to any to resolve type mismatch between ethers v6 and clob-client expected types
const wallet = /** @type {any} */ (new ethers.Wallet(pKey, provider));

const clobClient = new ClobClient(
    'https://clob.polymarket.com/', 
    137, 
    // @ts-ignore
    wallet, 
    {
        apiKey: process.env.POLY_API_KEY,
        apiSecret: process.env.POLY_API_SECRET,
        apiPassphrase: process.env.POLY_PASSPHRASE
    }
);

async function getBinanceOpenPrice(timestampMs) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${CONFIG.binanceSymbol.toUpperCase()}&interval=1m&startTime=${timestampMs}&limit=1`;
        const res = await axios.get(url);
        if (res.data && res.data.length > 0) {
            return parseFloat(res.data[0][1]);
        }
    } catch (e) {
        console.error(chalk.red(`> Failed to fetch historical start price: ${e.message}`));
    }
    return null;
}

async function resolveMarkets(rawSlugs) {
    
    for (const rawSlug of rawSlugs) {
        let cleanSlug = rawSlug;
        let specificTid = null;

        // --- CHECK 1: PURE ID INPUT (Recommended) ---
        // If input contains only digits, assume it's a Market ID directly
        if (/^\d+$/.test(rawSlug.trim())) {
             specificTid = rawSlug.trim();
             cleanSlug = "RAW_ID_MODE"; 
             console.log(chalk.cyan(`> DETECTED RAW ID INPUT: ${specificTid}`));
        } 
        // --- CHECK 2: URL with tid param ---
        else if (rawSlug.includes('tid=')) {
            const parts = rawSlug.split('?');
            cleanSlug = parts[0].trim();
            const urlParams = new URLSearchParams(parts[1]);
            specificTid = urlParams.get('tid');
        } 
        // --- CHECK 3: Standard Slug ---
        else {
            cleanSlug = rawSlug.split('?')[0].trim();
        }

        console.log(chalk.yellow(`> Resolving: ${cleanSlug} (TID: ${specificTid || 'None'})`));
        broadcast('LOG', { message: `Resolving Market...` });

        try {
            let targetMarket = null;

            // --- STRATEGY 1: DIRECT TID LOOKUP (Primary) ---
            if (specificTid) {
                try {
                    console.log(chalk.blue(`> Querying Gamma API for ID: ${specificTid}`));
                    const directRes = await axios.get(`https://gamma-api.polymarket.com/markets/${specificTid}`);
                    if (directRes.data) {
                        targetMarket = directRes.data;
                        console.log(chalk.green(`> MARKET FOUND VIA ID!`));
                    }
                } catch (tidErr) {
                    console.log(chalk.yellow(`> Direct TID lookup failed (${tidErr.message})...`));
                }
            }

            // --- STRATEGY 2: SLUG SEARCH (Fallback, only if not in Raw ID mode) ---
            if (!targetMarket && cleanSlug !== "RAW_ID_MODE") {
                const response = await axios.get(`https://gamma-api.polymarket.com/events?slug=${cleanSlug}`);
                if (response.data.length > 0) { 
                    const eventData = response.data[0];
                    const markets = eventData.markets;

                    if (specificTid) {
                        targetMarket = markets.find(m => m.id == specificTid || (m.clobTokenIds && JSON.stringify(m.clobTokenIds).includes(specificTid)));
                    } else {
                        targetMarket = markets[0];
                    }
                }
            }

            if (!targetMarket) {
                 console.error(chalk.red(`> Market not found. Please verify ID.`)); 
                 broadcast('ERROR', { message: `Market ID Not Found` });
                 continue; 
            }
            
            if (targetMarket.closed) {
                 console.error(chalk.red(`> SKIPPING: Market is already CLOSED.`)); 
                 broadcast('ERROR', { message: `Market Closed` });
                 continue; 
            }

            let upTokenId = null; 
            let downTokenId = null;
            
            let tokenIds = targetMarket.clobTokenIds;
            if (typeof tokenIds === 'string') {
                try { tokenIds = JSON.parse(tokenIds); } catch(e) {}
            }
            
            const outcomes = JSON.parse(targetMarket.outcomes);
            outcomes.forEach((outcomeName, index) => {
                const name = outcomeName.toUpperCase();
                // Handle BOTH 'UP'/'DOWN' and 'YES'/'NO'
                if (name === 'UP' || name === 'YES') upTokenId = tokenIds[index];
                if (name === 'DOWN' || name === 'NO') downTokenId = tokenIds[index];
            });

            if (!upTokenId || !downTokenId) {
                console.error(chalk.red(`> Could not identify UP/DOWN/YES/NO tokens`));
                broadcast('ERROR', { message: `Tokens Not Found` });
                continue;
            }
            
            const startTs = new Date(targetMarket.startDate).getTime();
            
            let referencePrice = await getBinanceOpenPrice(startTs);
            if (!referencePrice) {
                 console.log(chalk.red(`> Could not fetch reference price. Using 0 (Expect Manual Override).`));
                 referencePrice = 0; 
            }
            
            console.log(chalk.green(`> LOCKED: ${targetMarket.id} | Ref: $${referencePrice}`));
            
            broadcast('MARKET_LOCKED', {
                slug: rawSlug, 
                referencePrice: referencePrice,
                upId: upTokenId,
                downId: downTokenId
            });

            activeMarkets.push({
                slug: rawSlug, 
                upId: upTokenId, 
                downId: downTokenId, 
                referencePrice: referencePrice, 
                lastTrade: 0
            });
        } catch (e) { 
            console.error(chalk.red(`> Error resolving: ${e.message}`));
            broadcast('ERROR', { message: `API Error: ${e.message}` });
        }
    }

    if (activeMarkets.length === 0) { 
        console.log(chalk.bgYellow.black("\n> SYSTEM IDLE: No open markets found."));
    } else {
        console.log(chalk.blue(`> Engine Ready. Streaming...`));
        startTrading();
    }
}

function startTrading() {
    if (binanceWs) return;

    console.log(chalk.blue(`> Connecting to Binance Stream (${CONFIG.binanceSymbol})...`));
    binanceWs = new WebSocket(`wss://stream.binance.com:9443/ws/${CONFIG.binanceSymbol}@trade`);
    
    binanceWs.on('open', () => {
        console.log(chalk.blue('> WebSocket Connected.'));
        broadcast('STATUS', { status: 'RUNNING' });
    });
    
    binanceWs.on('message', async (data) => {
        ticks++;
        if (isProcessing) return;
        isProcessing = true;
        try {
            const trade = JSON.parse(data);
            const spotPrice = parseFloat(trade.p);
            
            if (activeMarkets.length > 0) {
                const m = activeMarkets[0];
                broadcast('PRICE_UPDATE', {
                    sourcePrice: spotPrice,
                    referencePrice: m.referencePrice,
                    delta: spotPrice - m.referencePrice,
                    slug: m.slug
                });
            }

            await checkArbitrage(spotPrice);
        } catch (e) { }
        isProcessing = false;
    });
    
    binanceWs.on('close', () => {
        console.log(chalk.yellow('> Binance WS Closed. Reconnecting...'));
        binanceWs = null;
        setTimeout(startTrading, 2000);
    });
    
    binanceWs.on('error', () => {
        binanceWs.terminate();
        binanceWs = null;
    });
}

async function checkArbitrage(spotPrice) {
    // Iterate backwards so we can splice safely
    for (let i = activeMarkets.length - 1; i >= 0; i--) {
        const market = activeMarkets[i];

        if (Date.now() - market.lastTrade < 5000) continue;
        const delta = spotPrice - market.referencePrice;
        const absDelta = Math.abs(delta);
        
        if (absDelta < CONFIG.minPriceDelta) continue;

        const winningTokenId = delta > 0 ? market.upId : market.downId;
        const direction = delta > 0 ? "UP" : "DOWN";

        if (!winningTokenId) continue;

        try {
            const orderbook = await clobClient.getOrderBook(winningTokenId);
            if (!orderbook.asks || orderbook.asks.length === 0) continue;
            const bestAsk = parseFloat(orderbook.asks[0].price);
            
            if (bestAsk <= CONFIG.maxEntryPrice) {
                console.log(chalk.bgGreen.black(`\n SNIPE SIGNAL `));
                console.log(`Delta: ${delta.toFixed(2)} | Target: ${direction} | Price: ${bestAsk}`);
                
                broadcast('SNIPE_SIGNAL', {
                    direction: direction,
                    delta: delta,
                    price: bestAsk,
                    market: market.slug
                });

                await executeTrade(market, winningTokenId, bestAsk, direction);
            }
        } catch (err) {
            // --- FAIL SAFE ---
            // If ANY error happens getting the book (404, 500, Network), we KILL the market tracking
            // to prevents infinite spam loops.
            console.log(chalk.red(`\n> ⛔ MARKET ERROR (${market.slug}): Removing from tracker.`));
            broadcast('ERROR', { message: `Removed Broken Market: ${market.slug}` });
            activeMarkets.splice(i, 1);
        }
    }
}

async function executeTrade(market, tokenId, price, direction) {
    console.log(chalk.yellow(`> EXECUTING ${direction} ORDER...`));
    market.lastTrade = Date.now();
    try {
        const rawSize = CONFIG.betSizeUSDC / price;
        const size = Math.floor(rawSize * 100) / 100; 
        const order = await clobClient.createOrder({
            tokenID: tokenId, price: price, side: Side.BUY, size: size, feeRateBps: 0, nonce: Date.now(),
        });
        const resp = await clobClient.postOrder(order);
        console.log(chalk.green(`> ORDER SUBMITTED: ${resp.orderID}`));
        
        broadcast('TRADE_EXECUTED', {
            id: resp.orderID,
            asset: market.slug,
            type: direction,
            amount: CONFIG.betSizeUSDC,
            price: price,
            status: 'SUCCESS'
        });

    } catch (e) { 
        console.error(chalk.red(`> TRADE FAILED: ${e.message}`));
        broadcast('TRADE_FAILED', {
            error: e.message,
            asset: market.slug
        });
    }
}

resolveMarkets(CONFIG.marketSlugs);