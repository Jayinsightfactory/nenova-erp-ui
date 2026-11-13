'use strict';
// Only the exact named, labelled container ID created by our setup may be removed.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const stateFile=path.join(process.cwd(),'work/mixed-load/db-state.json');
if(!fs.existsSync(stateFile)){console.log('No synthetic SQL fixture state');process.exit(0);}
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(state.host!=='127.0.0.1'||state.database!=='NenovaUploadSynthetic'||!/^nenova-upload-synthetic-\d+$/.test(state.name)||!/^[a-f0-9]{64}$/.test(state.containerId))throw Error('Unsafe synthetic fixture state');
const inspect=spawnSync('docker',['inspect',state.containerId,'--format','{{json .}}'],{encoding:'utf8'});
if(inspect.status!==0)throw Error('Cannot verify exact synthetic container; state retained');
const info=JSON.parse(inspect.stdout);
if(info.Id!==state.containerId||info.Name!=='/'+state.name||info.Config.Labels['nenova.synthetic']!=='upload-load')throw Error('Container identity/label mismatch; refusing cleanup');
const removed=spawnSync('docker',['rm','-f',state.containerId],{encoding:'utf8'});
if(removed.status!==0)throw Error('Synthetic container cleanup failed; state retained');
fs.unlinkSync(stateFile);console.log(JSON.stringify({syntheticContainerRemoved:true,name:state.name}));
