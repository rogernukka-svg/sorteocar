const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

console.log('Iniciando sistema Miño Goup...');
console.log('Sistema premium: http://localhost:3000/premium/');

const online = spawn(process.execPath, ['scripts/online-server.js'], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
  detached: true
});

online.unref();

const bot = spawn(process.execPath, ['index.js'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false
});

bot.on('exit', (code) => {
  process.exit(code || 0);
});
