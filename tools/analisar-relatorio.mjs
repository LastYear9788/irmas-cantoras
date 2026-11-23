// Uso: node tools/analisar-relatorio.mjs caminho/do/irmas-cantoras-relatorio-....json
// Mostra quanto da vez da pessoa contou, por que o resto não contou e em que momento.
import fs from 'fs';
import { analyze } from '../js/singlog.js';

const file = process.argv[2];
if (!file) { console.log('Uso: node tools/analisar-relatorio.mjs relatorio.json'); process.exit(1); }

let data;
try { data = fs.readFileSync(file, 'utf8'); }
catch (e) { console.error(`Não achei o arquivo "${file}". Confere o caminho.`); process.exit(1); }
try { data = JSON.parse(data); }
catch (e) { console.error(`"${file}" não é um relatório válido (o arquivo está cortado ou não é JSON).`); process.exit(1); }
if (!data || typeof data !== 'object' || !data.cols) {
  console.error(`"${file}" não parece um relatório do Irmãs Cantoras.`);
  process.exit(1);
}
console.log(analyze(data));
