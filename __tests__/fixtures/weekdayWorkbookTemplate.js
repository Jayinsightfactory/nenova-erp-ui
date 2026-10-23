import JSZip from 'jszip';
export async function weekdayWorkbookFixture() {
  const zip=new JSZip();
  zip.file('xl/workbook.xml','<workbook><sheets><sheet name="주광 카장수알 38-39차 발주 수량" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData>'+[1,2,3,27,28].map(r=>`<row r="${r}" ht="21"><c r="A${r}" s="0"/></row>`).join('')+'</sheetData></worksheet>');
  zip.file('xl/styles.xml','<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>');
  return zip.generateAsync({type:'uint8array'});
}
