const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

console.log('Iniciando sistema Miño Goup...');
console.log('Panel: http://localhost:5176/pwa/');

const panel = spawn(process.execPath, ['scripts/panel-server.js'], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
  detached: true
});

panel.unref();

const bot = spawn(process.execPath, ['index.js'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false
});

bot.on('exit', (code) => {
  process.exit(code || 0);
});
