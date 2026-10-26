// Compile le moteur Rust en WebAssembly et copie le résultat dans wasm/ (fichier versionné, pour
// que la version navigateur se construise sans Rust). Il faut la cible :
//   rustup target add wasm32-unknown-unknown
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Le moteur des réglages, et le développement des photos RAW (chargé seulement pour un RAW).
for (const [name, out] of [
  ['poulpe-engine-wasm', 'poulpe_engine.wasm'],
  ['poulpe-raw-wasm', 'poulpe_raw.wasm'],
]) {
  const crate = join(here, '../../../crates', name);
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
    cwd: crate,
    stdio: 'inherit',
  });
  copyFileSync(
    join(crate, `target/wasm32-unknown-unknown/release/${name.replaceAll('-', '_')}.wasm`),
    join(here, '../wasm', out),
  );
  console.log(`wasm/${out} à jour`);
}
