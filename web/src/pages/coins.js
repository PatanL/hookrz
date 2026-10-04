import '../styles/base.css';
import '../styles/coins.css';
import { mountChrome } from '../ui/chrome.js';

mountChrome('coins');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap"><span class="eyebrow">coins</span><h1 class="chrome-text">Coming together</h1></div></section>`;
