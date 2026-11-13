'use strict';
function closeMainAction({mainCount,notesOpen,explicitQuit=false}) {
  return explicitQuit||mainCount===1&&!notesOpen?'quit':'close-window';
}
module.exports={closeMainAction};
