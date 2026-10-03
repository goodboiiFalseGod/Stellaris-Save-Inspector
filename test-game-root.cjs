'use strict';

const fs = require('node:fs');
const path = require('node:path');

const settingsPath = path.join(__dirname, 'settings.local.json');
const configured = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')).gameLocation : null;
const root = process.env.STELLARIS_GAME_DIR || configured;
if (!root || !path.isAbsolute(root)) throw new Error('Укажите STELLARIS_GAME_DIR или настройте папку игры в интерфейсе.');
module.exports = {root, gamePath: relative => path.join(root, relative.replace(/^\.\.[\\/]/, ''))};
