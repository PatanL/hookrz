import '../styles/base.css';
import '../styles/coin.css';
import { mountChrome } from '../ui/chrome.js';

mountChrome('coin');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap"><span class="eyebrow">coin</span><h1 class="chrome-text">Coming together</h1></div></section>`;
