import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.LEARNING_CHECKOUT)throw new Error('Define LEARNING_CHECKOUT con el checkout canónico de Learning.');
const source=await readFile(path.join(process.env.LEARNING_CHECKOUT,'apps/web/src/features/live/engine-preparation.contract.ts'),'utf8');
const expected='// Generado desde Learning; mantener sincronizado con su contrato de preparación.\n'+source.replace(/\r\n/g,'\n');
const target=path.join(root,'apps/web/src/domains/course-delivery/types/engine-preparation.contract.ts');
if(process.argv.includes('--check')){
  if((await readFile(target,'utf8')).replace(/\r\n/g,'\n')!==expected)throw new Error('El contrato de preparación no coincide con Learning.');
}else await writeFile(target,expected);
