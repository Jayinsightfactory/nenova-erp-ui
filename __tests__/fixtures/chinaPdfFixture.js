const item=(str,x,y)=>({str,x,y,width:String(str).length*4});
const page=items=>({items,text:items.map(value=>value.str).join(' ')});

function product(y,{category,chinese,name,length,carton,boxes,bunches,stems,weight,price,amount}){
  return [
    item(category,52.44,y),item(chinese,90.4,y),item(name,132.9,y),item(length,251.7,y),
    item('10stem/bunch',276.8,y),item('10',319.6,y),item('100*40*20',362,y),item(carton,404,y),
    item(String(boxes),445.8,y),item(String(bunches),489.6,y),item(String(price),price==='-'?543.4:533.7,y),
    item(String(stems),556.8,y),item(String(weight),587.5,y),item(String(amount),amount==='-'?646.1:632.5,y),
  ];
}
function charge(y,number,label,quantity,unit,amount){
  return [item(String(number),68.7,y),item(label,110,y),item(String(quantity),196.5,y),
    item(String(unit),230,y),item(String(amount),255.9,y)];
}

/** Synthetic, public-safe positioned PDF.js input for parser and client flow tests. */
export function makeChinaPdfFixture(){
  const first=[
    item('KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD',274.1,531),
    item('日期DATE: 4/10/2026',553.03,478),item('发票号INVOICE NO. SAMPLE-001',553.03,467),
    item('Category',57.36,418),item('Chinese Name',90.264,418),item('English item name',132.86,418),
    item('Stem',252.4,422),item('Length',249.8,414),item('Order',439.4,418),
    item('Total of Flower',471.91,422),item('Material',481.4,414),item('单价UNIT',521.7,426),
    item('Stems',554.34,418),item('A.G.W.T.',583,418),item('金额合计AM',617,417),item('(CNY)',624.8,401),
    ...product(387,{category:'配花',chinese:'蕾丝',name:'아미초 (Ammi)',length:'60-70cm',carton:'1',boxes:1,bunches:10,stems:100,weight:'10.00',price:'10.00',amount:'100.00'}),
    ...product(362,{category:'单头玫瑰',chinese:'测试玫瑰',name:'장미 테스트 (Rose)',length:'65CM',carton:'2-3',boxes:2,bunches:20,stems:200,weight:'20.00',price:'10.00',amount:'200.00'}),
  ];
  const second=[
    ...product(542,{category:'配花',chinese:'白水晶',name:'리모늄 (Sinensis white)',length:'70cm',carton:'4',boxes:1,bunches:10,stems:100,weight:'10.00',price:'-',amount:'-'}),
    item('4',443.2,243),item('40',485.6,243),item('400',553,243),item('40.00',584.1,243),item('300.00',621.7,243),
    item('Charge items /费用项目',112.1,174),
    ...charge(151,1,'BOXING AND PACKING/纸箱打包',4,'5.00','20.00'),
    ...charge(122,2,'SEA FREIGHT CHARGE/海运费',1,'10.00','10.00'),
  ];
  const third=[
    ...charge(459,3,'花材金额',1,'300.00','300.00'),
    item('Total additional charges/附加费用合计',106.9,441),item('330.00',251.4,441),
  ];
  return {pages:[page(first),page(second),page(third)]};
}
