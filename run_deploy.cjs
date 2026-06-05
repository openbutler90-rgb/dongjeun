const {spawnSync} = require('child_process');
const path = 'C:/Users/dhvnf/Downloads/\u{B3D9}\u{C804}\u{CEE4}\u{D53C}';

console.log('Working dir:', path);
console.log('--- npm run build ---');
const build = spawnSync('npm', ['run', 'build'], {
  cwd: path,
  shell: true,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
if (build.error) { console.error('Build error:', build.error.message); process.exit(1); }
console.log(build.stdout);
if (build.stderr) console.log(build.stderr);
if (build.status !== 0) { console.error('Build FAILED with code', build.status); process.exit(1); }

console.log('--- firebase deploy ---');
const deploy = spawnSync('firebase', ['deploy'], {
  cwd: path,
  shell: true,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
if (deploy.error) { console.error('Deploy error:', deploy.error.message); process.exit(1); }
console.log(deploy.stdout);
if (deploy.stderr) console.log(deploy.stderr);
console.log('Exit code:', deploy.status);
