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
const VERSION = "v6.15 (ROBUST RESOLVER)";
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
    marketSlugs: [''], // Start empty
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
    // 1. IMMEDIATE SYNC
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
            
            if (data.type === 'UPDATE_CONFIG') {
                const { slug, betSize, maxEntryPrice, minPriceDelta, referencePrice } = data.payload;
                
                if (betSize !== undefined) CONFIG.betSizeUSDC = parseFloat(betSize);
                if (maxEntryPrice !== undefined) CONFIG.maxEntryPrice = parseFloat(maxEntryPrice);
                if (minPriceDelta !== undefined) CONFIG.minPriceDelta = parseFloat(minPriceDelta);

                const rawSlug = slug ? slug.toString().trim() : null;
                const newRefPrice = referencePrice ? parseFloat(referencePrice) : null;
                
                console.log(chalk.magenta(`\n> UI CONFIG UPDATE:`));
                console.log(chalk.dim(`  Input: ${rawSlug}`));

                // Apply Ref Price Override immediately if we have a market
                if (newRefPrice && activeMarkets.length > 0) {
                    activeMarkets[0].referencePrice = newRefPrice;
                    broadcast('MARKET_LOCKED', {
                        slug: activeMarkets[0].slug,
                        referencePrice: newRefPrice,
                        upId: activeMarkets[0].upId,
                        downId: activeMarkets[0].downId
                    });
                }

                // Resolve New Market if input provided
                if (rawSlug) {
                     console.log(chalk.magenta(`  Resolving Input: ${rawSlug}`));
                     broadcast('LOG', { message: `Searching for ${rawSlug}...` });
                     
                     // Reset state
                     activeMarkets = [];
                     CONFIG.marketSlugs = [rawSlug];
                     
                     try {
                        await resolveMarkets(CONFIG.marketSlugs);
                        
                        // If user provided a ref price during the resolution phase, apply it now
                        if (newRefPrice && activeMarkets.length > 0) {
                            activeMarkets[0].referencePrice = newRefPrice;
                            broadcast('MARKET_LOCKED', {
                                slug: activeMarkets[0].slug,
                                referencePrice: newRefPrice,
                                upId: activeMarkets[0].upId,
                                downId: activeMarkets[0].downId
                            });
                        }
                     } catch (err) {
                        console.error("Resolution Crash:", err);
                        broadcast('ERROR', { message: "Internal Resolution Error" });
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

// --- SAFE PARSER HELPER ---
function safeParse(input) {
    if (Array.isArray(input)) return input;
    if (typeof input === 'object' && input !== null) return input; // already object
    if (typeof input === 'string') {
        try { return JSON.parse(input); } catch (e) { return null; }
    }
    return null;
}

async function resolveMarkets(rawSlugs) {
    for (const rawSlug of rawSlugs) {
        if (!rawSlug) continue;

        let cleanSlug = rawSlug;
        let specificTid = null;

        // --- CHECK 1: PURE ID INPUT ---
        if (/^\d+$/.test(rawSlug)) {
             specificTid = rawSlug;
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
        else {
            cleanSlug = rawSlug.split('?')[0].trim();
        }

        console.log(chalk.yellow(`> Resolving...`));
        broadcast('LOG', { message: `Querying API...` });

        try {
            let targetMarket = null;

            // STRATEGY 1: DIRECT MARKET ID LOOKUP
            if (specificTid) {
                try {
                    console.log(chalk.blue(`> Trying /markets/${specificTid}...`));
                    const directRes = await axios.get(`https://gamma-api.polymarket.com/markets/${specificTid}`);
                    if (directRes.data) {
                        targetMarket = directRes.data;
                        console.log(chalk.green(`> Found Market Object via ID.`));
                    }
                } catch (err) {
                    console.log(chalk.yellow(`> /markets/${specificTid} failed: ${err.message}`));
                }

                // STRATEGY 2: EVENT LOOKUP BY ID (Fallback)
                if (!targetMarket) {
                    try {
                        console.log(chalk.blue(`> Trying /events?id=${specificTid}...`));
                        const eventRes = await axios.get(`https://gamma-api.polymarket.com/events?id=${specificTid}`);
                        if (eventRes.data && eventRes.data.length > 0) {
                            const markets = eventRes.data[0].markets;
                            targetMarket = markets.find(m => m.id == specificTid); // Loose equality
                            if(targetMarket) console.log(chalk.green(`> Found Market inside Event.`));
                        }
                    } catch (err) {
                        console.log(chalk.yellow(`> /events?id=${specificTid} failed.`));
                    }
                }
            }

            // STRATEGY 3: SLUG SEARCH
            if (!targetMarket && cleanSlug !== "RAW_ID_MODE") {
                const response = await axios.get(`https://gamma-api.polymarket.com/events?slug=${cleanSlug}`);
                if (response.data.length > 0) { 
                    const markets = response.data[0].markets;
                    if (specificTid) {
                        targetMarket = markets.find(m => m.id == specificTid || (m.clobTokenIds && JSON.stringify(m.clobTokenIds).includes(specificTid)));
                    } else {
                        targetMarket = markets[0];
                    }
                }
            }

            // --- FINAL VALIDATION ---
            if (!targetMarket) {
                 console.error(chalk.red(`> Market NOT FOUND for input: ${rawSlug}`)); 
                 broadcast('ERROR', { message: `Market Not Found` });
                 continue; 
            }
            
            if (targetMarket.closed) {
                 console.error(chalk.red(`> Market CLOSED.`)); 
                 broadcast('ERROR', { message: `Market Closed` });
                 continue; 
            }

            // --- ROBUST TOKEN ID PARSING ---
            // Outcomes and TokenIds can be strings OR arrays depending on the API response version
            const outcomes = safeParse(targetMarket.outcomes);
            const tokenIds = safeParse(targetMarket.clobTokenIds);

            if (!outcomes || !Array.isArray(outcomes) || !tokenIds || !Array.isArray(tokenIds)) {
                console.error(chalk.red(`> Data Parsing Error: outcomes/tokens format invalid.`));
                console.log("Outcomes:", targetMarket.outcomes);
                console.log("Tokens:", targetMarket.clobTokenIds);
                broadcast('ERROR', { message: `Data Parsing Error` });
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
                console.error(chalk.red(`> Could not find UP/DOWN or YES/NO outcomes.`));
                broadcast('ERROR', { message: `Outcomes Not Compatible` });
                continue;
            }
            
            const startTs = new Date(targetMarket.startDate).getTime();
            let referencePrice = await getBinanceOpenPrice(startTs);
            if (!referencePrice) {
                 console.log(chalk.red(`> Ref Price not found, defaulting to 0.`));
                 referencePrice = 0; 
            }
            
            console.log(chalk.green(`> LOCKED: ${targetMarket.id} | Ref: $${referencePrice}`));
            
            // Success Broadcast
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
            console.error(chalk.red(`> Unhandled Error: ${e.message}`));
            console.error(e);
            broadcast('ERROR', { message: `System Error: ${e.message}` });
        }
    }

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

// Initial Kickoff
resolveMarkets(CONFIG.marketSlugs);