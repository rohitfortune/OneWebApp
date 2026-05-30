import sys

with open('src/components/Files.tsx', 'r') as f:
    content = f.read()

# Chunk 1
c1_target = """  type DialogState = {
    title: string;
    message?: string;
    type: 'alert' | 'confirm' | 'prompt';
    confirmText?: string;
    onConfirm: (val?: string) => void;
  };"""
c1_repl = """  type DialogState = {
    title: string;
    message?: string;
    type: 'alert' | 'confirm' | 'prompt' | 'move_picker';
    confirmText?: string;
    onConfirm: (val?: string) => void;
  };"""
content = content.replace(c1_target, c1_repl)

c1b_target = "  const [dialog, setDialog] = useState<DialogState | null>(null);"
c1b_repl = "  const [dialog, setDialog] = useState<DialogState | null>(null);\n\n  const longPressTimer = useRef<NodeJS.Timeout | null>(null);"
content = content.replace(c1b_target, c1b_repl)

# Chunk 2
c2_target = "  const menuRef = useRef<HTMLDivElement>(null);"
c2_repl = """
  const handlePointerDown = (idStr: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      if (!selectionMode) {
        setSelectionMode(true);
        setSelectedItemIds(new Set([idStr]));
      } else {
        toggleSelection(idStr);
      }
    }, 500); // 500ms long press
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const isDescendant = (parentId: number, childId: number): boolean => {
    let curr = allFolders.find(f => f.id === childId);
    while (curr && curr.parentId !== undefined) {
      if (curr.parentId === parentId) return true;
      curr = allFolders.find(f => f.id === curr!.parentId);
    }
    return false;
  };

  const executeMove = async (targetFolderId: number | undefined, idsToMove: Set<string>) => {
    for (const idStr of idsToMove) {
      const parts = idStr.split('-');
      const type = parts[0];
      const id = parseInt(parts[1]);

      if (type === 'file') {
        await db.localFiles.update(id, { folderId: targetFolderId, lastModified: Date.now() });
      } else if (type === 'folder') {
        if (id === targetFolderId || (targetFolderId && isDescendant(id, targetFolderId))) {
          continue;
        }
        await db.localFolders.update(id, { parentId: targetFolderId, lastModified: Date.now() });
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, idStr: string) => {
    e.dataTransfer.setData('text/plain', idStr);
  };

  const handleDrop = async (e: React.DragEvent, targetFolderId: number | undefined) => {
    e.preventDefault();
    const idStr = e.dataTransfer.getData('text/plain');
    if (idStr) {
      await executeMove(targetFolderId, new Set([idStr]));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const openMovePicker = () => {
    setDialog({
      title: 'Move To...',
      type: 'move_picker',
      onConfirm: async (val) => {
        const targetId = val === 'home' ? undefined : parseInt(val!);
        await executeMove(targetId, selectedItemIds);
        setSelectionMode(false);
        setSelectedItemIds(new Set());
        setDialog(null);
      }
    });
  };

  const menuRef = useRef<HTMLDivElement>(null);
"""
content = content.replace(c2_target, c2_repl)

# Chunk 3
c3_target = """  const handleFolderClick = (folder: FolderRecord) => {
    if (selectionMode) {"""
c3_repl = """  const handleFolderClick = (folder: FolderRecord) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (selectionMode) {"""
content = content.replace(c3_target, c3_repl)

c4_target = """  const handleFileDownload = (file: FileRecord) => {
    if (selectionMode) {"""
c4_repl = """  const handleFileDownload = (file: FileRecord) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (selectionMode) {"""
content = content.replace(c4_target, c4_repl)

# Chunk 5
c5_target = """              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px', color: '#ff4444' }} onClick={handleDeleteSelected}>🗑️ Delete</button>"""
c5_repl = """              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={openMovePicker}>➡️ Move</button>
              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px', color: '#ff4444' }} onClick={handleDeleteSelected}>🗑️ Delete</button>"""
content = content.replace(c5_target, c5_repl)

# Chunk 6
c6_target = """              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              {dialog.type !== 'alert' && (
                <button 
                  className="btn-secondary" 
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
              )}
              <button """
c6_repl = """              />
            )}
            {dialog.type === 'move_picker' && (
              <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  style={{ padding: '12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-primary)' }}
                  onClick={() => dialog.onConfirm('home')}
                >
                  🏠 Home (Root)
                </button>
                {allFolders.filter(f => !selectedItemIds.has(`folder-${f.id}`)).map(f => (
                  <button 
                    key={f.id}
                    style={{ padding: '12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}
                    onClick={() => dialog.onConfirm(f.id!.toString())}
                  >
                    📂 {f.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              {dialog.type !== 'alert' && (
                <button 
                  className="btn-secondary" 
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
              )}
              {dialog.type !== 'move_picker' && (
                <button """
content = content.replace(c6_target, c6_repl)

c6b_target = """              </button>
            </div>
          </div>"""
c6b_repl = """              </button>
              )}
            </div>
          </div>"""
content = content.replace(c6b_target, c6b_repl)

# Chunk 7 (Folder attributes)
c7_target = """            <div
              key={`folder-${folder.id}`}
              onClick={() => handleFolderClick(folder)}
              className="item-card\""""
c7_repl = """            <div
              key={`folder-${folder.id}`}
              onClick={() => handleFolderClick(folder)}
              onPointerDown={() => handlePointerDown(`folder-${folder.id}`)}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              draggable={!selectionMode}
              onDragStart={(e) => handleDragStart(e, `folder-${folder.id}`)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, folder.id)}
              className="item-card\""""
content = content.replace(c7_target, c7_repl)

# Chunk 8 (File attributes)
c8_target = """            <div
              key={`file-${file.id}`}
              onClick={() => handleFileDownload(file)}
              className="item-card\""""
c8_repl = """            <div
              key={`file-${file.id}`}
              onClick={() => handleFileDownload(file)}
              onPointerDown={() => handlePointerDown(`file-${file.id}`)}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              draggable={!selectionMode}
              onDragStart={(e) => handleDragStart(e, `file-${file.id}`)}
              className="item-card\""""
content = content.replace(c8_target, c8_repl)

# Chunk 9 (Breadcrumbs drop)
c9_target = """        <span 
          style={{ cursor: 'pointer', color: currentFolderId === undefined ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: currentFolderId === undefined ? 700 : 400 }}
          onClick={() => setCurrentFolderId(undefined)}
        >"""
c9_repl = """        <span 
          style={{ cursor: 'pointer', color: currentFolderId === undefined ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: currentFolderId === undefined ? 700 : 400 }}
          onClick={() => setCurrentFolderId(undefined)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, undefined)}
        >"""
content = content.replace(c9_target, c9_repl)

c10_target = """            <span 
              style={{ cursor: 'pointer', color: idx === breadcrumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: idx === breadcrumbs.length - 1 ? 700 : 400 }}
              onClick={() => setCurrentFolderId(crumb.id)}
            >"""
c10_repl = """            <span 
              style={{ cursor: 'pointer', color: idx === breadcrumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: idx === breadcrumbs.length - 1 ? 700 : 400 }}
              onClick={() => setCurrentFolderId(crumb.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, crumb.id)}
            >"""
content = content.replace(c10_target, c10_repl)

# Prevent text selection magnifier on mobile during long press
style_target = """                border: isSelected ? '2px solid var(--accent)' : 'none',
                background: isSelected ? 'var(--accent-soft)' : undefined
              }}"""
style_repl = """                border: isSelected ? '2px solid var(--accent)' : 'none',
                background: isSelected ? 'var(--accent-soft)' : undefined,
                userSelect: 'none', WebkitUserSelect: 'none'
              }}"""
content = content.replace(style_target, style_repl)

with open('src/components/Files.tsx', 'w') as f:
    f.write(content)

print("Files.tsx updated.")
