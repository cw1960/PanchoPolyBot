/**
 * index.ts
 * 
 * Entry point for the Node.js process.
 * Boots the BotEngine.
 */

import { BotEngine } from './core/bot';

const bot = new BotEngine();
bot.start();
