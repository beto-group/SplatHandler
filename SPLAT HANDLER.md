---
cssclasses:
  - bfv-container
---

```datacorejsx
const activeFile = dc.resolvePath("SPLAT HANDLER") || "_RESOURCES/DATACORE/_DONE/SPLAT HANDLER/SPLAT HANDLER";
const folderPath = activeFile.substring(0, activeFile.lastIndexOf('/'));

const { View } = await dc.require(folderPath + "/src/index.jsx");
return await View({ folderPath });
```
