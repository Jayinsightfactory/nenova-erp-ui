// Creates only a disposable loopback SQL Server with synthetic fixture accounts.
// State (including random synthetic-only credentials) stays in ignored work/mixed-load.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const sql=require('mssql');
const fixtureDir=path.join(process.cwd(),'work','mixed-load');fs.mkdirSync(fixtureDir,{recursive:true});fs.writeFileSync(path.join(fixtureDir,'.gitignore'),'*\n!.gitignore\n');
const stateFile=path.join(fixtureDir,'db-state.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 if(fs.existsSync(stateFile))throw Error('Existing test state must be explicitly cleaned up first');
 const state={name:'nenova-upload-synthetic-'+Date.now(),host:'127.0.0.1',port:14339,password:'Synthetic!'+crypto.randomBytes(20).toString('hex'),database:'NenovaUploadSynthetic',user:'sa'};
 const image='mcr.microsoft.com/mssql/server@sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89';
 const child=spawnSync('docker',['run','-d','--name',state.name,'--label','nenova.synthetic=upload-load','--memory','2g','--cpus','1','-p',`127.0.0.1:${state.port}:1433`,'-e','ACCEPT_EULA=Y','-e','MSSQL_SA_PASSWORD','-e','MSSQL_MEMORY_LIMIT_MB=1024',image],{encoding:'utf8',env:{...process.env,MSSQL_SA_PASSWORD:state.password}});
 if(child.status!==0)throw Error('Docker synthetic container start failed');
 state.containerId=child.stdout.trim();fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
 const config={server:state.host,port:state.port,user:state.user,password:state.password,database:'master',options:{encrypt:false,trustServerCertificate:true},connectionTimeout:3000};
 let pool;for(let i=0;i<90;i++){try{pool=await new sql.ConnectionPool(config).connect();break;}catch{await sleep(1000);}}
 if(!pool)throw Error('Synthetic SQL readiness timeout');
 await pool.request().query(`CREATE DATABASE ${state.database}`);await pool.close();
 pool=await new sql.ConnectionPool({...config,database:state.database}).connect();
 await pool.request().query(`CREATE TABLE UserInfo(UserID NVARCHAR(60) PRIMARY KEY,UserName NVARCHAR(100),Password NVARCHAR(100),Authority INT,DeptName NVARCHAR(60),isDeleted BIT NOT NULL DEFAULT 0)`);
 state.loginPassword='SyntheticLogin!'+crypto.randomBytes(12).toString('hex');
 for(let i=1;i<=20;i++)await pool.request().input('id',sql.NVarChar,'synthetic'+String(i).padStart(2,'0')).input('name',sql.NVarChar,'Synthetic User '+i).input('password',sql.NVarChar,state.loginPassword).query(`INSERT INTO UserInfo(UserID,UserName,Password,Authority,DeptName,isDeleted) VALUES(@id,@name,@password,9,N'Synthetic fixture',0)`);
 await pool.close();fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
 console.log(JSON.stringify({container:state.name,syntheticUsers:20,sqlReady:true,port:state.port}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
