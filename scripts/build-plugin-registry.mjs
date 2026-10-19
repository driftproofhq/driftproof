// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=new URL('../config/models.json',import.meta.url);
const destination=new URL('../plugin/driftproof/config/models.json',import.meta.url);
const bytes=fs.readFileSync(source);
if(process.argv.includes('--check')){
 if(!fs.existsSync(destination)||!bytes.equals(fs.readFileSync(destination)))throw Error('STALE_PLUGIN_REGISTRY: '+fileURLToPath(destination));
}else fs.writeFileSync(destination,bytes);
console.log('plugin registry: '+(process.argv.includes('--check')?'current':'generated'));
