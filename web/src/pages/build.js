import '../styles/base.css';
import '../styles/build.css';
import { mountChrome } from '../ui/chrome.js';

mountChrome('build');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap"><span class="eyebrow">build</span><h1 class="chrome-text">Coming together</h1></div></section>`;
