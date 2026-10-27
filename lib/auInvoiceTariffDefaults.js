// Historical company workbook values, not a statutory tariff table.
const sourceHash='7cb66ca12afce9ff937ea8bd6fda597c4ce411174961638fa276ed6713dfd320';
const rows=[
 [251,'Banker Bush',14,0],[717,'Emu Feather',15,0],[823,'Emu Grass',16,0],
 [719,'Koala Fern',17,0],[2999,'Copper Glow',18,0.069],[721,'Fern Sea Star',19,0],
 [824,'Steel Grass',20,0],[1742,'Stenocarpus',21,0],[723,'Fern Umbrella',23,0],
 [2997,'Wolly Bush Green Tip',24,0],[2998,'Wolly Bush Red Tip',null,0],
];
export function auInvoiceTariffDefault(document,product){
 const m=/^(\d{2})-(\d{2})$/.exec(String(document?.orderWeek||''));
 if(document?.orderYear!=='2026'||!m||Number(m[1])*100+Number(m[2])<3901
   ||document.reviewedMetadata?.country!=='AU'||document.reviewedMetadata?.transportMode!=='AIR'
   ||!product||product.isDeleted||product.CounName?.trim()!=='호주')return null;
 const row=rows.find(([key,name])=>key===Number(product.ProdKey)&&name.toLowerCase()===product.ProdName?.trim().toLowerCase());
 if(!row)return null;
 return {prodKey:row[0],tariffRate:row[3],sourceHash:row[2]?sourceHash:null,
   label:row[2]?`기존 호주 원가자료 39-1 · I${row[2]} · ${row[3]*100}%`:'2026-10-27 담당 승인 · Red Tip 0%',
   sourceProduct:row[1],sourceWeek:row[2]?'39-01':null};
}
