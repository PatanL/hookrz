import '../styles/base.css';
import '../styles/stacks.css';
import { mountChrome } from '../ui/chrome.js';

mountChrome('stacks');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap"><span class="eyebrow">stacks</span><h1 class="chrome-text">Coming together</h1></div></section>`;
