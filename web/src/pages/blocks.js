import '../styles/base.css';
import '../styles/blocks.css';
import { mountChrome } from '../ui/chrome.js';

mountChrome('blocks');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap"><span class="eyebrow">blocks</span><h1 class="chrome-text">Coming together</h1></div></section>`;
