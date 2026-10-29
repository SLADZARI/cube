import {homedir} from 'node:os';
import {join} from 'node:path';
import {createLocalMvpServer} from './local-free-mvp.mjs';

const host='127.0.0.1',port=18793;
const directory=join(homedir(),'Projects','studio-local-ollama-public-preview-data');
const {server}=await createLocalMvpServer({directory});
server.listen(port,host,()=>console.log('PUBLIC_LOCAL_PREVIEW_READY http://'+host+':'+port+'/canvas'));
