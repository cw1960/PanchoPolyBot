import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
const WebSocketServer = WebSocket.Server;

import { ethers } from 'ethers';
import { ClobClient, Side } from '@polymarket/clob-client';
import chalk from 'chalk';
import axios from 'axios';
import process from 'process';

// --- VERSION CHECK ---
const VERSION = "v6.3 (FAIL-SAFE)";
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
    marketSlugs: (process.env.MARKET_SLUG || '').split(',').map(s => s.trim()).filter(s => s),
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
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'UPDATE_CONFIG') {
                const newSlug = data.payload.slug;
                if (!newSlug) return;

                console.log(chalk.magenta(`\n> UI REQUEST: Switching to market: ${newSlug}`));
                broadcast('LOG', { message: `Switching to ${newSlug}...` });
                
                activeMarkets = [];
                CONFIG.marketSlugs = [newSlug];
                await resolveMarkets(CONFIG.marketSlugs);
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
const wallet = new ethers.Wallet(pKey, provider);

const clobClient = new ClobClient(
    'https://clob.polymarket.com/', 
    137, 
    /** @type {any} */ (wallet), 
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

async function resolveMarkets(slugs) {
    console.log(chalk.yellow(`> Resolving ${slugs.length} Up/Down Markets...`));
    broadcast('LOG', { message: `Resolving ${slugs.length} markets...` });

    for (const slug of slugs) {
        try {
            const response = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
            if (response.data.length === 0) { 
                console.error(chalk.red(`> Market not found: ${slug}`)); 
                broadcast('ERROR', { message: `Market Not Found: ${slug}` });
                continue; 
            }

            const market = response.data[0].markets[0];
            
            if (market.closed) {
                 console.error(chalk.red(`> SKIPPING: ${slug} is already CLOSED.`)); 
                 broadcast('ERROR', { message: `Market Closed: ${slug}` });
                 continue; 
            }

            let upTokenId = null; 
            let downTokenId = null;
            
            let tokenIds = market.clobTokenIds;
            if (typeof tokenIds === 'string') {
                try { tokenIds = JSON.parse(tokenIds); } catch(e) {}
            }
            
            const outcomes = JSON.parse(market.outcomes);
            outcomes.forEach((outcomeName, index) => {
                const name = outcomeName.toUpperCase();
                if (name === 'UP') upTokenId = tokenIds[index];
                if (name === 'DOWN') downTokenId = tokenIds[index];
            });

            if (!upTokenId || !downTokenId) {
                console.error(chalk.red(`> Could not identify UP/DOWN tokens for ${slug}`));
                continue;
            }
            
            const startTs = new Date(market.startDate).getTime();
            
            let referencePrice = await getBinanceOpenPrice(startTs);
            if (!referencePrice) {
                 console.log(chalk.red(`> Could not fetch reference price for ${slug}`));
                 broadcast('ERROR', { message: `Binance Price Not Found for Start Time` });
                 continue;
            }
            
            console.log(chalk.green(`> LOCKED: ${slug} | Ref: $${referencePrice}`));
            
            broadcast('MARKET_LOCKED', {
                slug: slug,
                referencePrice: referencePrice,
                upId: upTokenId,
                downId: downTokenId
            });

            activeMarkets.push({
                slug: slug, upId: upTokenId, downId: downTokenId, referencePrice: referencePrice, lastTrade: 0
            });
        } catch (e) { 
            console.error(chalk.red(`> Error resolving ${slug}: ${e.message}`));
            broadcast('ERROR', { message: `API Error: ${e.message}` });
        }
    }

    if (activeMarkets.length === 0) { 
        console.error(chalk.red("> No active markets configured. Idle..."));
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