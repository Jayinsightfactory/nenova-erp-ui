import {listVisible,getFileForVerification} from './workDrive';
import {preserveCostHistory} from './invoiceCostHistoryStore.js';
export function exportWithCostHistory(bytes,context,user){
 return preserveCostHistory({bytes,context,user,listFiles:listVisible,readFile:getFileForVerification});
}
