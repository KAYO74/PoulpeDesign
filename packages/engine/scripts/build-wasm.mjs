// Compile le moteur Rust en WebAssembly et copie le résultat dans wasm/ (fichier versionné, pour
// que la version navigateur se construise sans Rust). Il faut la cible :
//   rustup target add wasm32-unknown-unknown
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, '../../../crates/poulpe-engine-wasm');
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
});
copyFileSync(
  join(crate, 'target/wasm32-unknown-unknown/release/poulpe_engine_wasm.wasm'),
  join(here, '../wasm/poulpe_engine.wasm'),
);
console.log('wasm/poulpe_engine.wasm à jour');
