const path = require('node:path');
if (!process.env.MARKETING_CLOSEOUT_SOURCE) throw new Error('MARKETING_CLOSEOUT_SOURCE must name the isolated candidate');
const font = path.join(process.env.MARKETING_CLOSEOUT_SOURCE, 'app/fonts/Satoshi-Variable.woff2');
module.exports = new Proxy({}, { get(_, key) { const name = new URL(key).searchParams.get("family").split(":")[0].replaceAll("+", " "); return `/* latin */\n@font-face {\nfont-family: '${name}';\nfont-style: normal;\nfont-weight: 100 900;\nsrc: url(${font});\n}`; } });
