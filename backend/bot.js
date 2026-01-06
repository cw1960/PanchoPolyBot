require('dotenv').config();
const WebSocket = require('ws');
const { ethers } = require('ethers');
const { ClobClient } = require('@polymarket/clob-client');
const chalk = require('chalk');
const axios = require('axios'); // Requires: npm install axios

// CONFIGURATION
const CONFIG = {
    threshold: parseFloat(process.env.TRIGGER_THRESHOLD_PERCENT || '0.5'), 
    betSize: parseFloat(process.env.BET_SIZE_USDC || '10'),
    binanceSymbol: process.env.BINANCE_SYMBOL || 'btcusdt',
    marketSlug: process.env.MARKET_SLUG || 'bitcoin-above-100k-jan-2025', // Use SLUG, not ID
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
};

// VALIDATION
if (!process.env.PRIVATE_KEY || !process.env.POLY_API_KEY) {
    console.error(chalk.red('FATAL: Missing credentials in .env file.'));
    process.exit(1);
}

let activeTokenId = null; // Will be resolved dynamically

// SETUP
console.log(chalk.green(`> PANCHOPOLYBOT STARTING (TOKYO/GLOBAL)...`));

// 1. Setup Client
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

// 2. Market Resolution (The "Discovery" Phase)
async function resolveMarketSlug(slug) {
    console.log(chalk.yellow(`> Resolving Market Slug: ${slug}...`));
    try {
        // Query Gamma API (Polymarket's Indexer)
        const response = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
        
        if (response.data.length === 0) {
            throw new Error('Market not found');
        }

        // Assuming the first market in the event is the main one (simplified)
        const market = response.data[0].markets[0];
        const yesTokenId = market.clobTokenIds[1]; // Index 1 is usually YES
        
        console.log(chalk.green(`> Market Found: ${market.question}`));
        console.log(chalk.green(`> Target Token ID (YES): ${yesTokenId}`));
        
        activeTokenId = yesTokenId;
        startTrading();
        
    } catch (e) {
        console.error(chalk.red('> Failed to resolve market slug. Check spelling.'));
        console.error(e.message);
        process.exit(1);
    }
}

// 3. Trading Loop
function startTrading() {
    let isTrading = false; 

    // Binance Global WebSocket
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${CONFIG.binanceSymbol}@trade`);

    ws.on('open', async () => {
        console.log(chalk.blue('> Connected to Binance Global.'));
    });

    ws.on('message', async (data) => {
        if (isTrading) return;
        const trade = JSON.parse(data);
        const spotPrice = parseFloat(trade.p);
        checkArbitrageOpportunity(spotPrice);
    });

    async function checkArbitrageOpportunity(spotPrice) {
        if (!activeTokenId) return;
        
        try {
            const orderbook = await clobClient.getOrderBook(activeTokenId);
            if (!orderbook.asks || orderbook.asks.length === 0) return;

            const bestAsk = parseFloat(orderbook.asks[0].price);
            process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Spot: $${spotPrice.toFixed(2)} | Poly: ${bestAsk.toFixed(3)} `);
            
            // Logic for calculating the spread and firing trade goes here...
            
        } catch (err) {}
    }
}

// START
resolveMarketSlug(CONFIG.marketSlug);
