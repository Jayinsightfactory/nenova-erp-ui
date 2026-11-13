'use strict';
const path=require('node:path');
const APP_ID='com.nenova.workspace';
function windowAppDetails({platform=process.platform,packaged,execPath,resourcesPath,appDir}){
 if(platform!=='win32')return null;
 return {appId:APP_ID,relaunchDisplayName:'네노바 업무',appIconPath:packaged?path.join(resourcesPath,'app-icon.ico'):path.join(appDir,'assets','icon.ico'),appIconIndex:0,relaunchCommand:'"'+execPath+'"'+(packaged?'':' "'+appDir+'"')};
}
function applyWindowIdentity(win,options){const details=windowAppDetails(options);if(details){win.setAppDetails(details);win.setSkipTaskbar(false);}return details;}
module.exports={APP_ID,windowAppDetails,applyWindowIdentity};
