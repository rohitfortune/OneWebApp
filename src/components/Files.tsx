import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FileRecord, type FolderRecord } from '../db/db';
import JSZip from 'jszip';

export default function Files() {
  const allFiles = useLiveQuery(() => db.localFiles.filter(f => f.deleted !== 1).toArray()) || [];
  const allFolders = useLiveQuery(() => db.localFolders.filter(f => f.deleted !== 1).toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<'top' | 'bottom'>('top');
  
  // Folder Navigation State
  const [currentFolderId, setCurrentFolderId] = useState<number | undefined>(undefined);
  
  // Selection Mode State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isZipping, setIsZipping] = useState(false);
  const [readyToShareFiles, setReadyToShareFiles] = useState<File[] | null>(null);
  
  // Custom Prompts
  type DialogState = {
    title: string;
    message?: string;
    type: 'alert' | 'confirm' | 'prompt' | 'move_picker';
    confirmText?: string;
    onConfirm: (val?: string) => void;
  };
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // --- Handlers ---
  

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


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const record: FileRecord = {
        uuid: crypto.randomUUID(),
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
        blob: file,
        folderId: currentFolderId,
        lastModified: Date.now()
      };
      await db.localFiles.add(record);
    }
    e.target.value = '';
    setDialog({
      title: 'Success',
      message: 'File uploaded and saved securely!',
      type: 'alert',
      onConfirm: () => setDialog(null)
    });
    setShowMenu(false);
  };

  const handleCreateFolder = () => {
    setDialog({
      title: 'Create Folder',
      type: 'prompt',
      confirmText: 'Create',
      onConfirm: async (name) => {
        if (name && name.trim()) {
          await db.localFolders.add({ 
            uuid: crypto.randomUUID(),
            name: name.trim(), 
            parentId: currentFolderId, 
            lastModified: Date.now() 
          });
        }
        setDialog(null);
      }
    });
    setShowMenu(false);
  };

  const handleFileDownload = async (file: FileRecord) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (selectionMode) {
      toggleSelection(`file-${file.id}`);
      return;
    }
    
    const shareFile = new File([file.blob], file.displayName, { type: file.mimeType || 'application/octet-stream' });
    
    try {
      if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        await navigator.share({ files: [shareFile] });
      } else {
        const url = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.displayName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error(e);
      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
         alert('Error opening file: ' + (e.message || 'Unknown error'));
      }
    }
  };

  const handleFolderClick = (folder: FolderRecord) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (selectionMode) {
      toggleSelection(`folder-${folder.id}`);
      return;
    }
    setCurrentFolderId(folder.id);
    setSearchQuery('');
  };

  const handleFileDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDialog({
      title: 'Delete File',
      message: 'Are you sure you want to delete this file permanently?',
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        await db.localFiles.update(id, { deleted: 1, blob: new Blob([]), lastModified: Date.now() });
        setSelectedItemIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(`file-${id}`);
          return newSet;
        });
        setDialog(null);
      }
    });
  };

  const handleFolderDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const childFolders = allFolders.filter(f => f.parentId === id);
    const childFiles = allFiles.filter(f => f.folderId === id);
    
    const hasChildren = childFolders.length > 0 || childFiles.length > 0;
    
    setDialog({
      title: 'Delete Folder',
      message: hasChildren ? 'This folder is not empty. Are you sure you want to delete it and all its contents recursively?' : 'Are you sure you want to delete this folder?',
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        const deleteRecursively = async (folderId: number) => {
          const subFolders = allFolders.filter(f => f.parentId === folderId);
          const subFiles = allFiles.filter(f => f.folderId === folderId);
          for (const sf of subFolders) await deleteRecursively(sf.id!);
          for (const file of subFiles) {
            await db.localFiles.update(file.id!, { deleted: 1, blob: new Blob([]), lastModified: Date.now() });
            setSelectedItemIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(`file-${file.id}`);
              return newSet;
            });
          }
          await db.localFolders.update(folderId, { deleted: 1, lastModified: Date.now() });
          setSelectedItemIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(`folder-${folderId}`);
            return newSet;
          });
        };
        await deleteRecursively(id);
        setDialog(null);
      }
    });
  };

  const toggleSelection = (idStr: string) => {
    const newSel = new Set(selectedItemIds);
    if (newSel.has(idStr)) newSel.delete(idStr);
    else newSel.add(idStr);
    setSelectedItemIds(newSel);
    setReadyToShareFiles(null);
  };

  const forceDownloadFiles = (files: File[]) => {
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  };

  const handleShareSingleFile = async (e: React.MouseEvent, fileRec: FileRecord) => {
    e.stopPropagation();
    const fileObj = new File([fileRec.blob], fileRec.displayName, { type: fileRec.mimeType });
    if (navigator.share && navigator.canShare) {
      if (!navigator.canShare({ files: [fileObj] })) {
        setDialog({
          title: 'Download Instead?',
          message: 'Your browser blocks sharing this file type directly. Would you like to download it instead?',
          type: 'confirm',
          confirmText: 'Download',
          onConfirm: () => { forceDownloadFiles([fileObj]); setDialog(null); }
        });
        return;
      }
      try {
        await navigator.share({ title: 'Shared File', files: [fileObj] });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setDialog({
            title: 'Download Instead?',
            message: 'Share failed. Would you like to download the file instead?',
            type: 'confirm',
            confirmText: 'Download',
            onConfirm: () => { forceDownloadFiles([fileObj]); setDialog(null); }
          });
        }
      }
    } else {
       setDialog({
         title: 'Download Instead?',
         message: 'Your browser does not support Web Share. Would you like to download the file instead?',
         type: 'confirm',
         confirmText: 'Download',
         onConfirm: () => { forceDownloadFiles([fileObj]); setDialog(null); }
       });
    }
  };

  const handleShareSelected = async () => {
    // If we have already generated the safe fallback ZIP, share it instantly and synchronously.
    if (readyToShareFiles) {
      try {
        await navigator.share({ title: 'Shared Files', files: readyToShareFiles });
      } catch (err: any) {
        console.error('Error sharing:', err);
        if (err.name !== 'AbortError') {
          setDialog({
            title: 'Download Instead?',
            message: 'Your device rejected the share action. Would you like to download the file instead?',
            type: 'confirm',
            confirmText: 'Download',
            onConfirm: () => { forceDownloadFiles(readyToShareFiles); setDialog(null); }
          });
        }
      }
      setSelectionMode(false);
      setSelectedItemIds(new Set());
      setReadyToShareFiles(null);
      return;
    }

    const fileIdsToShare: number[] = [];
    selectedItemIds.forEach(idStr => {
      if (idStr.startsWith('file-')) {
        fileIdsToShare.push(parseInt(idStr.split('-')[1]));
      }
    });

    if (fileIdsToShare.length === 0) {
      setDialog({
        title: 'Share Files',
        message: 'No files selected to share. (Folders cannot be shared directly)',
        type: 'alert',
        onConfirm: () => setDialog(null)
      });
      return;
    }

    const filesToShare = allFiles.filter(f => fileIdsToShare.includes(f.id!));
    let fileObjects = filesToShare.map(f => new File([f.blob], f.displayName, { type: f.mimeType }));

    if (navigator.share && navigator.canShare) {
      // If browser blocks the file types natively, we must zip them.
      // Zipping is async, which breaks Web Share API's strict "transient user activation" rule.
      // We must wait, then ask user to click a secondary "Ready" button to natively share.
      if (!navigator.canShare({ files: fileObjects })) {
        setIsZipping(true);
        try {
          const zip = new JSZip();
          filesToShare.forEach(f => {
            zip.file(f.displayName, f.blob);
          });
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const zipFile = new File([zipBlob], 'Secure_Attachments.zip', { type: 'application/zip' });
          
          if (navigator.canShare({ files: [zipFile] })) {
            setReadyToShareFiles([zipFile]);
          } else {
             const zipTxt = new File([zipBlob], 'Secure_Attachments.zip.txt', { type: 'text/plain' });
             setReadyToShareFiles([zipTxt]);
          }
        } catch (e) {
          console.error('Error generating zip:', e);
          setDialog({
            title: 'Download Instead?',
            message: 'Failed to compress files. Would you like to download them instead?',
            type: 'confirm',
            confirmText: 'Download',
            onConfirm: () => { forceDownloadFiles(fileObjects); setDialog(null); }
          });
          setSelectionMode(false);
          setSelectedItemIds(new Set());
        } finally {
          setIsZipping(false);
        }
        return; // Wait for user to click the Ready button
      }

      try {
        await navigator.share({
          title: 'Shared Files',
          files: fileObjects
        });
      } catch (err: any) {
        console.error('Error sharing:', err);
        if (err.name !== 'AbortError') {
          setDialog({
            title: 'Download Instead?',
            message: 'Your device rejected the share action. Would you like to download the files instead?',
            type: 'confirm',
            confirmText: 'Download',
            onConfirm: () => { forceDownloadFiles(fileObjects); setDialog(null); }
          });
        }
      }
      setSelectionMode(false);
      setSelectedItemIds(new Set());
      setReadyToShareFiles(null);
    } else {
      setDialog({
        title: 'Download Instead?',
        message: 'Your browser does not support the Web Share API. Would you like to download the files instead?',
        type: 'confirm',
        confirmText: 'Download',
        onConfirm: () => { forceDownloadFiles(fileObjects); setDialog(null); }
      });
      setSelectionMode(false);
      setSelectedItemIds(new Set());
    }
  };

  const handleDownloadSelected = () => {
    const filesToDownload: File[] = [];
    
    const addFolderFiles = (folderId: number) => {
      const childFiles = allFiles.filter(f => f.folderId === folderId);
      childFiles.forEach(f => filesToDownload.push(new File([f.blob], f.displayName, { type: f.mimeType })));
      const childFolders = allFolders.filter(f => f.parentId === folderId);
      childFolders.forEach(f => addFolderFiles(f.id!));
    };

    for (const idStr of selectedItemIds) {
      const [type, idPart] = idStr.split('-');
      const id = parseInt(idPart);
      if (type === 'file') {
        const fileRec = allFiles.find(f => f.id === id);
        if (fileRec) filesToDownload.push(new File([fileRec.blob], fileRec.displayName, { type: fileRec.mimeType }));
      } else {
        addFolderFiles(id);
      }
    }

    forceDownloadFiles(filesToDownload);
    setSelectionMode(false);
    setSelectedItemIds(new Set());
    setReadyToShareFiles(null);
  };

  const handleRenameSelected = () => {
    if (selectedItemIds.size !== 1) return;
    const idStr = Array.from(selectedItemIds)[0];
    const [type, idPart] = idStr.split('-');
    const id = parseInt(idPart);

    const oldName = type === 'file' 
      ? allFiles.find(f => f.id === id)?.displayName 
      : allFolders.find(f => f.id === id)?.name;

    if (!oldName) return;

    // Use a small timeout to let the click event finish before showing prompt modal
    setTimeout(() => {
      setDialog({
        title: 'Rename',
        type: 'prompt',
        confirmText: 'Rename',
        onConfirm: async (newName) => {
          if (newName && newName.trim() && newName !== oldName) {
            if (type === 'file') {
              await db.localFiles.update(id, { displayName: newName.trim(), lastModified: Date.now() });
            } else {
              await db.localFolders.update(id, { name: newName.trim(), lastModified: Date.now() });
            }
          }
          setSelectionMode(false);
          setSelectedItemIds(new Set());
          setDialog(null);
        }
      });
    }, 50);
  };
  
  const handleDeleteSelected = async () => {
    setDialog({
      title: 'Delete Selected',
      message: `Delete ${selectedItemIds.size} selected items?`,
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        for (const idStr of selectedItemIds) {
          const parts = idStr.split('-');
          const type = parts[0];
          const id = parseInt(parts[1]);
          
          if (type === 'file') {
            await db.localFiles.update(id, { deleted: 1, blob: new Blob([]), lastModified: Date.now() });
          } else if (type === 'folder') {
            const deleteRecursively = async (folderId: number) => {
              const subFolders = allFolders.filter(f => f.parentId === folderId);
              const subFiles = allFiles.filter(f => f.folderId === folderId);
              for (const sf of subFolders) await deleteRecursively(sf.id!);
              for (const file of subFiles) await db.localFiles.update(file.id!, { deleted: 1, blob: new Blob([]), lastModified: Date.now() });
              await db.localFolders.update(folderId, { deleted: 1, lastModified: Date.now() });
            };
            await deleteRecursively(id);
          }
        }
        setSelectionMode(false);
        setSelectedItemIds(new Set());
        setDialog(null);
      }
    });
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // --- Filtering and Breadcrumbs ---

  const currentFolders = allFolders.filter(f => f.parentId === currentFolderId && f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const currentFiles = allFiles.filter(f => f.folderId === currentFolderId && f.displayName.toLowerCase().includes(searchQuery.toLowerCase()));

  const breadcrumbs = [];
  let curr = currentFolderId;
  while (curr !== undefined) {
    const folder = allFolders.find(f => f.id === curr);
    if (folder) {
      breadcrumbs.unshift(folder);
      curr = folder.parentId;
    } else {
      break;
    }
  }

  return (
    <div className="files-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100vh - 160px)', position: 'relative' }}>
      {/* Upload and Search bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '16px' }}>
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flexGrow: 1,
            minWidth: 0,
            padding: '12px 16px',
            borderRadius: 'var(--border-radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-surface)'
          }}
        />

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button 
            className="btn-secondary" 
            onClick={(e) => {
              if (!showMenu) {
                const rect = e.currentTarget.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                if (spaceBelow < 200 && rect.top > 200) {
                  setMenuPosition('bottom');
                } else {
                  setMenuPosition('top');
                }
              }
              setShowMenu(!showMenu);
            }}
            style={{ width: '44px', height: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 'bold' }}
          >
            ⋮
          </button>
          
          {showMenu && (
            <div style={{ position: 'absolute', ...(menuPosition === 'bottom' ? { bottom: '100%', marginBottom: '8px' } : { top: '100%', marginTop: '8px' }), right: '0', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', padding: '8px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              <button 
                style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', background: 'transparent', border: 'none', color: 'var(--text-primary)', textAlign: 'left' }}
                onClick={() => { document.getElementById('file-upload-input')?.click(); setShowMenu(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: '2px' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                Upload File
              </button>
              <button 
                style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', background: 'transparent', border: 'none', color: 'var(--text-primary)', textAlign: 'left' }}
                onClick={handleCreateFolder}
              >
                <span>📂</span> Create Folder
              </button>
              <button 
                style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', background: 'transparent', border: 'none', color: 'var(--text-primary)', textAlign: 'left' }}
                onClick={() => { setSelectionMode(!selectionMode); setSelectedItemIds(new Set()); setReadyToShareFiles(null); setShowMenu(false); }}
              >
                <span>{selectionMode ? '❌' : '☑️'}</span> {selectionMode ? 'Cancel Selection' : 'Select'}
              </button>
            </div>
          )}

          <input
            type="file"
            id="file-upload-input"
            multiple
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Breadcrumbs */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px', overflowX: 'auto', paddingBottom: '8px', whiteSpace: 'nowrap' }}>
        <span 
          style={{ cursor: 'pointer', color: currentFolderId === undefined ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: currentFolderId === undefined ? 700 : 400 }}
          onClick={() => setCurrentFolderId(undefined)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, undefined)}
        >
          Home
        </span>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.id}>
            <span style={{ color: 'var(--text-tertiary)' }}>/</span>
            <span 
              style={{ cursor: 'pointer', color: idx === breadcrumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: idx === breadcrumbs.length - 1 ? 700 : 400 }}
              onClick={() => setCurrentFolderId(crumb.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, crumb.id)}
            >
              {crumb.name}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Scrollable Container */}
      <div style={{ flexGrow: 1, overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div 
          style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
            gap: '20px',
            alignContent: 'flex-start',
            paddingBottom: selectionMode ? '140px' : '20px'
          }}
        >
        {/* Render Folders */}
        {currentFolders.map((folder) => {
          const isSelected = selectedItemIds.has(`folder-${folder.id}`);
          return (
            <div
              key={`folder-${folder.id}`}
              onClick={() => handleFolderClick(folder)}
              onPointerDown={() => handlePointerDown(`folder-${folder.id}`)}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              draggable={!selectionMode}
              onDragStart={(e) => handleDragStart(e, `folder-${folder.id}`)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, folder.id)}
              className="item-card"
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'flex-start',
                gap: '12px',
                padding: '20px',
                position: 'relative',
                border: isSelected ? '2px solid var(--accent)' : 'none',
                background: isSelected ? 'var(--accent-soft)' : undefined,
                userSelect: 'none', WebkitUserSelect: 'none'
              }}
            >
              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '32px' }}>📂</span>
                {selectionMode ? (
                  <input type="checkbox" checked={isSelected} readOnly style={{ transform: 'scale(1.5)', marginTop: '8px' }} />
                ) : (
                  <button 
                    onClick={(e) => handleFolderDelete(folder.id!, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--text-tertiary)' }}
                  >
                    🗑️
                  </button>
                )}
              </div>
              
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                  {folder.name}
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <span>Folder</span>
                  <span>{new Date(folder.lastModified).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Render Files */}
        {currentFiles.map((file) => {
          const isSelected = selectedItemIds.has(`file-${file.id}`);
          return (
            <div
              key={`file-${file.id}`}
              onClick={() => handleFileDownload(file)}
              onPointerDown={() => handlePointerDown(`file-${file.id}`)}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              draggable={!selectionMode}
              onDragStart={(e) => handleDragStart(e, `file-${file.id}`)}
              className="item-card"
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'flex-start',
                gap: '12px',
                padding: '20px',
                position: 'relative',
                border: isSelected ? '2px solid var(--accent)' : 'none',
                background: isSelected ? 'var(--accent-soft)' : undefined,
                userSelect: 'none', WebkitUserSelect: 'none'
              }}
            >
              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '32px' }}>{getFileIcon(file.mimeType)}</span>
                {selectionMode ? (
                  <input type="checkbox" checked={isSelected} readOnly style={{ transform: 'scale(1.5)', marginTop: '8px' }} />
                ) : (
                  <div style={{ display: 'flex', gap: '20px' }}>
                    <button 
                      onClick={(e) => handleShareSingleFile(e, file)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--text-tertiary)' }}
                      title="Share"
                    >
                      🔗
                    </button>
                    <button 
                      onClick={(e) => handleFileDelete(file.id!, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--text-tertiary)' }}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
              
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span 
                  style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}
                  title={file.displayName}
                >
                  {file.displayName}
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <span>{formatBytes(file.blob.size)}</span>
                  <span>{new Date(file.lastModified).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          );
        })}

        {currentFolders.length === 0 && currentFiles.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-tertiary)', padding: '80px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '64px' }}>📂</span>
            <h3>No files stored in this folder</h3>
            <p style={{ fontSize: '14px' }}>Click the menu button to create folders or upload secure attachments.</p>
          </div>
        )}
        </div>

        {/* Fixed Bottom Action Bar for Selection Mode */}
        {selectionMode && (
          <div style={{
            position: 'sticky', bottom: 0, marginTop: 'auto',
            backgroundColor: 'var(--bg-surface)', padding: '16px', 
            boxShadow: '0 -4px 16px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', zIndex: 100, borderTop: '1px solid var(--border)',
            width: '100%'
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>{selectedItemIds.size} Items Selected</span>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              {selectedItemIds.size === 1 && (
                <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={handleRenameSelected}>✏️ Rename</button>
              )}
              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={handleDownloadSelected}>⬇️ Download</button>
              {isZipping ? (
                <button className="btn-primary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} disabled>⏳ Zipping</button>
              ) : readyToShareFiles ? (
                <button className="btn-primary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={handleShareSelected}>✨ Zip Ready</button>
              ) : (
                <button className="btn-primary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={handleShareSelected}>🔗 Share</button>
              )}
              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={openMovePicker}>➡️ Move</button>
              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px', color: '#ff4444' }} onClick={handleDeleteSelected}>🗑️ Delete</button>
              <button className="btn-secondary" style={{ flex: 1, padding: '10px 4px', fontSize: '13px' }} onClick={() => { setSelectionMode(false); setSelectedItemIds(new Set()); setReadyToShareFiles(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Custom Dialog Modal */}
      {dialog && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)', padding: '24px', borderRadius: '16px',
            width: '100%', maxWidth: '340px', boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid var(--border)'
          }}>
            <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>{dialog.title}</h3>
            {dialog.message && (
              <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {dialog.message}
              </p>
            )}
            {dialog.type === 'prompt' && (
              <input 
                type="text" 
                autoFocus 
                placeholder="Folder name..."
                id="dialog-prompt-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    dialog.onConfirm(val);
                  }
                }}
                style={{
                  padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-default)', color: 'var(--text-primary)',
                  fontSize: '15px'
                }}
              />
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
                <button 
                className="btn-primary" 
                style={dialog.confirmText === 'Delete' ? { backgroundColor: '#ff4444' } : {}}
                onClick={() => {
                  if (dialog.type === 'prompt') {
                    const input = document.getElementById('dialog-prompt-input') as HTMLInputElement;
                    dialog.onConfirm(input?.value);
                  } else {
                    dialog.onConfirm();
                  }
                }}
              >
                {dialog.confirmText || 'OK'}
              </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Helper to render beautiful visual icon based on mimetype
function getFileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎥';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar')) return '📦';
  if (mime.includes('text/') || mime.includes('json') || mime.includes('javascript')) return '📄';
  return '📁';
}
