import '../styles/base.css';
import '../styles/docs.css';
import { mountChrome } from '../ui/chrome.js';

mountChrome('docs');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap"><span class="eyebrow">docs</span><h1 class="chrome-text">Coming together</h1></div></section>`;
