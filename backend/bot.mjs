import dotenv from 'dotenv';
dotenv.config();

// @ts-ignore
import WebSocket, { WebSocketServer } from 'ws';
import { ethers } from 'ethers';
import { ClobClient, Side } from '@polymarket/clob-client';
import chalk from 'chalk';
import axios from 'axios';
import process from 'process';

// --- SAFETY NET: PREVENT CRASHES ---
process.on('uncaughtException', (err) => {
    console.error(chalk.bgRed.white.bold(`\n!!! UNCAUGHT EXCEPTION !!!`));
    console.error(chalk.red(err.stack || err.message));
    console.error(chalk.yellow(`Bot is staying alive...`));
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.bgRed.white.bold(`\n!!! UNHANDLED REJECTION !!!`));
    console.error(chalk.red(reason));
});

// --- VERSION CHECK ---
const VERSION = "v8.0 (ANTI-CRASH + RECONNECT)";
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
    marketSlugs: [''], 
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
    // Send immediate sync
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
    } else {
        ws.send(JSON.stringify({ type: 'LOG', timestamp: Date.now(), payload: { message: "Connected to Backend v8.0" } }));
    }

    ws.on('error', (err) => console.error(chalk.red(`> WS Client Error: ${err.message}`)));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'UPDATE_CONFIG') {
                const { slug, betSize, maxEntryPrice, minPriceDelta, referencePrice } = data.payload;
                
                if (betSize !== undefined) CONFIG.betSizeUSDC = parseFloat(betSize);
                if (maxEntryPrice !== undefined) CONFIG.maxEntryPrice = parseFloat(maxEntryPrice);
                if (minPriceDelta !== undefined) CONFIG.minPriceDelta = parseFloat(minPriceDelta);

                const rawInput = slug ? slug.toString().trim() : null;
                const newRefPrice = referencePrice ? parseFloat(referencePrice) : null;
                
                console.log(chalk.magenta(`\n> UI CONFIG UPDATE:`));
                console.log(chalk.dim(`  Input: ${rawInput}`));

                if (newRefPrice && activeMarkets.length > 0) {
                    activeMarkets[0].referencePrice = newRefPrice;
                    broadcast('MARKET_LOCKED', {
                        slug: activeMarkets[0].slug,
                        referencePrice: newRefPrice,
                        upId: activeMarkets[0].upId,
                        downId: activeMarkets[0].downId
                    });
                }

                if (rawInput) {
                     console.log(chalk.magenta(`  Resolving: ${rawInput}`));
                     broadcast('LOG', { message: `Resolving ${rawInput}...` });
                     
                     // Clear previous state safely
                     activeMarkets = [];
                     
                     try {
                        await resolveMarkets([rawInput]);
                     } catch (err) {
                        console.error("Resolution Crash:", err);
                        broadcast('ERROR', { message: `Resolution Failed: ${err.message}` });
                        broadcast('SEARCH_COMPLETE', { found: 0 }); // Ensure UI stops spinner
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
            try {
                client.send(message);
            } catch (e) {
                console.error(`> Broadcast failed to client: ${e.message}`);
            }
        }
    });
}

// --- POLYMARKET SETUP ---
const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
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

function safeParse(input) {
    if (Array.isArray(input)) return input;
    if (typeof input === 'object' && input !== null) return input;
    if (typeof input === 'string') {
        try { return JSON.parse(input); } catch (e) { return null; }
    }
    return null;
}

async function resolveMarkets(inputs) {
    let marketsFound = 0;
    
    for (const rawInput of inputs) {
        if (!rawInput) continue;

        let cleanInput = rawInput;
        let specificId = null;

        if (/^\d+$/.test(rawInput)) {
             specificId = rawInput;
        } else if (rawInput.includes('tid=')) {
            const parts = rawInput.split('?');
            cleanInput = parts[0].trim();
            const urlParams = new URLSearchParams(parts[1]);
            specificId = urlParams.get('tid');
        } else {
            cleanInput = rawInput.split('?')[0].trim();
        }

        console.log(chalk.yellow(`> Resolving: ${cleanInput} (ID: ${specificId || 'N/A'})`));
        broadcast('LOG', { message: `Checking API for ${cleanInput}...` });

        try {
            let targetMarket = null;

            if (specificId) {
                // A) Try as Market ID
                try {
                    const marketRes = await axios.get(`https://gamma-api.polymarket.com/markets/${specificId}`);
                    if (marketRes.data) targetMarket = marketRes.data;
                } catch (e) { /* Ignore 404 */ }

                // B) Try as Event ID (Fallback)
                if (!targetMarket) {
                    try {
                        const eventRes = await axios.get(`https://gamma-api.polymarket.com/events/${specificId}`);
                        if (eventRes.data) {
                             const markets = eventRes.data.markets;
                             if (markets && markets.length > 0) targetMarket = markets[0];
                        }
                    } catch (e) { /* Ignore */ }
                }
                
                // C) Try via query
                 if (!targetMarket) {
                     try {
                        const eventResQuery = await axios.get(`https://gamma-api.polymarket.com/events?id=${specificId}`);
                        if (eventResQuery.data && eventResQuery.data.length > 0) {
                             const markets = eventResQuery.data[0].markets;
                             if (markets && markets.length > 0) targetMarket = markets[0];
                        }
                     } catch(e) { /* Ignore */ }
                }
            }

            if (!targetMarket) {
                try {
                    console.log(chalk.blue(`> Trying slug search: ${cleanInput}`));
                    const slugRes = await axios.get(`https://gamma-api.polymarket.com/events?slug=${cleanInput}`);
                    if (slugRes.data.length > 0) {
                        const markets = slugRes.data[0].markets;
                        targetMarket = markets[0];
                    }
                } catch (e) { /* Ignore */ }
            }

            if (!targetMarket) {
                 console.error(chalk.red(`> Market NOT FOUND. Input: ${rawInput}`)); 
                 broadcast('ERROR', { message: `Market Not Found. Check ID/Slug.` });
                 continue; 
            }
            
            if (targetMarket.closed) {
                 console.error(chalk.red(`> Market CLOSED.`)); 
                 broadcast('ERROR', { message: `Market is Closed` });
                 continue; 
            }

            const outcomes = safeParse(targetMarket.outcomes);
            let tokenIds = safeParse(targetMarket.clobTokenIds);

            if ((!tokenIds || tokenIds.length === 0) && targetMarket.tokens) {
                 tokenIds = targetMarket.tokens.map(t => t.tokenId);
            }

            if (!outcomes || !tokenIds || outcomes.length !== tokenIds.length) {
                broadcast('ERROR', { message: `Data Parsing Error (Tokens)` });
                continue;
            }

            let upTokenId = null; 
            let downTokenId = null;
            
            outcomes.forEach((outcomeName, index) => {
                const name = String(outcomeName).toUpperCase();
                if (name === 'UP' || name === 'YES') upTokenId = tokenIds[index];
                if (name === 'DOWN' || name === 'NO') downTokenId = tokenIds[index];
            });

            if (!upTokenId || !downTokenId) {
                broadcast('ERROR', { message: `Tokens Not Compatible (No Yes/No)` });
                continue;
            }
            
            const startTs = new Date(targetMarket.startDate).getTime();
            let referencePrice = await getBinanceOpenPrice(startTs);
            if (!referencePrice) referencePrice = 0; 
            
            console.log(chalk.green(`> LOCKED: ${targetMarket.id}`));
            
            broadcast('MARKET_LOCKED', {
                slug: targetMarket.slug || rawInput, 
                referencePrice: referencePrice,
                upId: upTokenId,
                downId: downTokenId
            });

            activeMarkets.push({
                slug: targetMarket.slug || rawInput, 
                upId: upTokenId, 
                downId: downTokenId, 
                referencePrice: referencePrice, 
                lastTrade: 0
            });
            marketsFound++;

        } catch (e) { 
            console.error(chalk.red(`> Unhandled Error in loop: ${e.message}`));
            broadcast('ERROR', { message: `System Error: ${e.message}` });
        }
    }

    // Critical: Tell UI we are done, so spinner stops if nothing found.
    broadcast('SEARCH_COMPLETE', { found: marketsFound });

    if (activeMarkets.length === 0) { 
        console.log(chalk.bgYellow.black("\n> SYSTEM IDLE."));
    } else {
        console.log(chalk.blue(`> Engine Ready.`));
        startTrading();
    }
}

function startTrading() {
    if (binanceWs) return;

    console.log(chalk.blue(`> Connecting to Binance Stream (${CONFIG.binanceSymbol})...`));
    // @ts-ignore
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
                
                broadcast('SNIPE_SIGNAL', {
                    direction: direction,
                    delta: delta,
                    price: bestAsk,
                    market: market.slug
                });

                await executeTrade(market, winningTokenId, bestAsk, direction);
            }
        } catch (err) {
             // remove logic if 404, etc.
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