// Uso: node tools/analisar-relatorio.mjs caminho/do/irmas-cantoras-relatorio-....json
// Mostra quanto da vez da pessoa contou, por que o resto não contou e em que momento.
import fs from 'fs';
import { analyze } from '../js/singlog.js';

const file = process.argv[2];
if (!file) { console.log('Uso: node tools/analisar-relatorio.mjs relatorio.json'); process.exit(1); }
console.log(analyze(JSON.parse(fs.readFileSync(file, 'utf8'))));
