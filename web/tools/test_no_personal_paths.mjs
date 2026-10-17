// The repo is public: no home directories or cluster details in tracked files (links in reports were absolute paths).
import { execFileSync } from 'node:child_process';
const patterns = ['/Users/[a-z]', '/home/[a-z]', 'nfshomes', 'umiacs', 'nexus[a-z]*[0-9]', 'vulcan-'];
const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
let bad = '';
for (const p of patterns) {
  try { bad += execFileSync('git', ['grep', '-nIE', p, '--', '.', ':!web/assets', ':!*.min.js', ':!web/tools/test_no_personal_paths.mjs'], { encoding: 'utf8', cwd: top }); }
  catch (e) { if (e.status !== 1) throw e; }   // 1: no match
}
if (bad) { console.error('personal paths or cluster details in tracked files:\n' + bad.split('\n').slice(0, 20).join('\n')); process.exit(1); }
console.log('no personal paths OK');
