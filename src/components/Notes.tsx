import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type NoteRecord, type DrawingPath, type Point } from '../db/db';
import { deriveMasterKey, decryptPayload, base64ToArrayBuffer } from '../utils/crypto';
import { verifyLocalBiometrics } from '../utils/biometrics';
export default function Notes() {
  const notes: NoteRecord[] = useLiveQuery(() => db.notes.reverse().sortBy('lastModified')) || [];
  const [selectedNote, setSelectedNote] = useState<NoteRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Editor & Canvas drawing state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [redoPaths, setRedoPaths] = useState<DrawingPath[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [strokeColor, setStrokeColor] = useState('#ff6c00'); // default orange
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEraser, setIsEraser] = useState(false);

  // Note locking & unlock states
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<Set<number>>(new Set());
  const [unlockPassword, setUnlockPassword] = useState('');
  const [hasMasterPassword, setHasMasterPassword] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  // Attachment & Voice Recording States
  const [isAttachDropdownOpen, setIsAttachDropdownOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<any>(null);


  const canvasRef = useRef<SVGSVGElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const lastActiveNodeRef = useRef<Node | null>(null);
  const lastActiveOffsetRef = useRef<number>(0);

  const currentNoteIdRef = useRef<number | undefined>(undefined);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const pathsRef = useRef(paths);

  useEffect(() => {
    titleRef.current = title;
    contentRef.current = content;
    pathsRef.current = paths;
  }, [title, content, paths]);

  useEffect(() => {
    currentNoteIdRef.current = selectedNote?.id;
  }, [selectedNote?.id]);

  const updateLastActiveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      lastActiveNodeRef.current = r.startContainer;
      lastActiveOffsetRef.current = r.startOffset;
    }
  };

  // Sync editor fields when selected note changes (triggered strictly when selected Note ID changes)
  useEffect(() => {
    lastActiveNodeRef.current = null;
    lastActiveOffsetRef.current = 0;
    setIsEraser(false);
    setUnlockPassword('');

    // Check security configuration
    const checkSecurityConfig = async () => {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      setHasMasterPassword(!!(saltRec && verifierRec));

      const bioCredRec = await db.settings.get('vault_biometric_credential');
      setHasBiometrics(!!bioCredRec);
    };
    checkSecurityConfig();

    if (selectedNote) {
      setTitle(selectedNote.title);
      setContent(selectedNote.content);
      setPaths(selectedNote.paths || []);
      setRedoPaths([]);
      if (editorRef.current) {
        editorRef.current.innerHTML = selectedNote.content;
        // Wrap naked media and ensure cursor can be placed before/after block media
        setTimeout(() => processEditorMedia(), 0);
      }
    } else {
      setTitle('');
      setContent('');
      setPaths([]);
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
    }
  }, [selectedNote?.id, unlockedNoteIds.has(selectedNote?.id || 0)]);

  // Listen for selection changes in the entire document to capture caret position in real-time
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        lastActiveNodeRef.current = r.startContainer;
        lastActiveOffsetRef.current = r.startOffset;
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [selectedNote?.id]);

  // Close attachment dropdown when clicking outside and clean up recordings
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.attachment-dropdown') && !target.closest('button[title="Attach File or Media"]')) {
        setIsAttachDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  // Wrap naked media elements in .media-wrapper containers (contenteditable=false),
  // and ensure editable paragraphs exist before/after block media at editor boundaries
  const processEditorMedia = () => {
    if (!editorRef.current) return;
    const editor = editorRef.current;

    // Wrap any naked img, video, audio elements not already inside a .media-wrapper
    const mediaElements = editor.querySelectorAll('img, video, audio');
    mediaElements.forEach((el) => {
      const parent = el.parentElement;
      if (parent && parent.classList.contains('media-wrapper')) return;
      if (el.closest('.embedded-file-card')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'media-wrapper';
      wrapper.setAttribute('contenteditable', 'false');
      el.parentNode?.insertBefore(wrapper, el);
      wrapper.appendChild(el);
    });

    // Ensure editable paragraphs at boundaries so cursor can land before/after media
    const children = editor.childNodes;
    if (children.length === 0) return;

    const isNonEditable = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.classList.contains('media-wrapper')) return true;
        if (el.classList.contains('embedded-file-card')) return true;
        if (['VIDEO', 'IMG', 'AUDIO'].includes(el.tagName)) return true;
      }
      return false;
    };

    if (isNonEditable(children[0])) {
      const p = document.createElement('div');
      p.innerHTML = '<br>';
      editor.insertBefore(p, children[0]);
    }
    const last = children[children.length - 1];
    if (isNonEditable(last)) {
      const p = document.createElement('div');
      p.innerHTML = '<br>';
      editor.appendChild(p);
    }
  };

  // Delete a media/file node and sync content
  const deleteMediaNode = (node: HTMLElement) => {
    node.remove();
    if (editorRef.current) {
      processEditorMedia();
      const newContent = editorRef.current.innerHTML;
      setContent(newContent);
      if (selectedNote) {
        db.notes.update(selectedNote.id!, {
          content: newContent,
          lastModified: Date.now()
        });
      }
    }
  };

  // Format command helper for selection edit
  const formatText = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setContent(editorRef.current.innerHTML);
    }
  };



  // Insert a media/file block as a direct child of the editor, always on its own line.
  // Finds the block currently containing the cursor and inserts the media after it,
  // so it never gets nested inside an existing line even if that line is empty.
  const insertMediaBlock = (html: string) => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    editor.focus();

    // Parse the HTML into a real DOM node
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const mediaNode = tmp.firstChild as HTMLElement | null;
    if (!mediaNode) return;

    // Find the direct editor child that contains the cursor (or last child as fallback)
    let anchorBlock: HTMLElement | null = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).startContainer;
      while (node && node.parentNode !== editor) {
        node = node.parentNode;
      }
      if (node && node.parentNode === editor) {
        anchorBlock = node as HTMLElement;
      }
    }
    if (!anchorBlock && editor.lastChild) {
      anchorBlock = editor.lastChild as HTMLElement;
    }

    // Create trailing empty line so cursor has somewhere to go after the media
    const emptyLine = document.createElement('div');
    emptyLine.innerHTML = '<br>';

    // Insert media + empty line after the anchor block
    if (anchorBlock) {
      anchorBlock.after(mediaNode, emptyLine);
    } else {
      editor.appendChild(mediaNode);
      editor.appendChild(emptyLine);
    }

    // Place cursor inside the empty line
    const range = document.createRange();
    range.setStart(emptyLine, 0);
    range.collapse(true);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    lastActiveNodeRef.current = emptyLine;
    lastActiveOffsetRef.current = 0;

    // Wrap naked media and save
    processEditorMedia();
    const newContent = editor.innerHTML;
    setContent(newContent);
    if (selectedNote) {
      db.notes.update(selectedNote.id!, {
        content: newContent,
        lastModified: Date.now()
      });
    }
  };


  // Check if a video can actually be played by the current browser
  const isVideoPlayable = (file: File): boolean => {
    const testVideo = document.createElement('video');
    // canPlayType returns '', 'maybe', or 'probably'
    return testVideo.canPlayType(file.type) !== '';
  };

  const handlePhotoVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    e.target.value = '';
    setIsAttachDropdownOpen(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (!result) return;

      if (file.type.startsWith('image/')) {
        const html = `<div class="media-wrapper" contenteditable="false"><img src="${result}" alt="${file.name}" style="max-width: 100%; border-radius: var(--border-radius-md); display: block; box-shadow: var(--shadow-md);" /></div>`;
        insertMediaBlock(html);
        return;
      }

      if (file.type.startsWith('video/')) {
        if (isVideoPlayable(file)) {
          // Browser can play this — embed as inline player
          const html = `<div class="media-wrapper" contenteditable="false"><video src="${result}" controls style="max-width: 100%; border-radius: var(--border-radius-md); display: block; box-shadow: var(--shadow-md);"></video></div>`;
          insertMediaBlock(html);
        } else {
          // Browser can't play this format — offer it as a download card
          const sizeInMB = file.size / (1024 * 1024);
          const sizeStr = sizeInMB >= 1 ? `${sizeInMB.toFixed(2)} MB` : `${(file.size / 1024).toFixed(1)} KB`;
          const html = `
            <div class="embedded-file-card" contenteditable="false" data-file-name="${file.name}" data-file-data="${result}" data-file-type="${file.type}">
              <div class="file-icon">🎥</div>
              <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${sizeStr} • Not supported for inline playback • Tap to download</div>
              </div>
            </div>`;
          insertMediaBlock(html.trim());
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (!result) return;

      const sizeInMB = file.size / (1024 * 1024);
      const sizeStr = sizeInMB >= 1 
        ? `${sizeInMB.toFixed(2)} MB` 
        : `${(file.size / 1024).toFixed(1)} KB`;

      let fileIcon = '📄';
      if (file.name.endsWith('.zip') || file.name.endsWith('.rar') || file.name.endsWith('.tar') || file.name.endsWith('.gz')) {
        fileIcon = '📦';
      } else if (file.name.endsWith('.pdf')) {
        fileIcon = '📕';
      } else if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
        fileIcon = '📘';
      } else if (file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) {
        fileIcon = '📗';
      } else if (file.type.startsWith('audio/')) {
        fileIcon = '🎵';
      }

      const html = `
        <div class="embedded-file-card" contenteditable="false" data-file-name="${file.name}" data-file-data="${result}" data-file-type="${file.type}">
          <div class="file-icon">${fileIcon}</div>
          <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-meta">${sizeStr} • Click to download</div>
          </div>
        </div>
      `;

      insertMediaBlock(html.trim());
    };

    reader.readAsDataURL(file);
    e.target.value = '';
    setIsAttachDropdownOpen(false);
  };

  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      const options = { mimeType: 'audio/webm' };
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch (err) {
        recorder = new MediaRecorder(stream);
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      setIsAttachDropdownOpen(false);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Failed to start audio recording:', err);
      alert('Could not access microphone. Please grant permission and try again.');
    }
  };

  const stopAudioRecording = (save: boolean) => {
    if (!mediaRecorderRef.current || !isRecording) return;

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    
    if (save) {
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          if (result) {
            insertMediaBlock(`<div class="media-wrapper" contenteditable="false"><audio controls src="${result}" style="width: 100%; max-width: 450px; display: block; border-radius: var(--border-radius-sm); border: 1px solid var(--border); background-color: var(--bg-surface-elevated);"></audio></div>`);
          }
        };
        reader.readAsDataURL(audioBlob);
        
        if (recorder.stream) {
          recorder.stream.getTracks().forEach((track) => track.stop());
        }
      };
    } else {
      recorder.onstop = () => {
        if (recorder.stream) {
          recorder.stream.getTracks().forEach((track) => track.stop());
        }
      };
    }

    recorder.stop();
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Unlock locked note using the Vault Master Password
  const handleDecryptNoteWithPassword = async () => {
    if (!selectedNote || !selectedNote.id) return;
    try {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) {
        alert('Master password not configured inside Vault settings.');
        return;
      }

      const salt = new Uint8Array(base64ToArrayBuffer(saltRec.value));
      const key = await deriveMasterKey(unlockPassword, salt);

      const decryptedVerifier = await decryptPayload(verifierRec.value, key);
      if (decryptedVerifier === 'VALID_VAULT_KEY') {
        // Unlock successful!
        setUnlockedNoteIds((prev) => {
          const next = new Set(prev);
          next.add(selectedNote.id!);
          return next;
        });
        setUnlockPassword('');
      } else {
        alert('Invalid Master Password. Please try again.');
      }
    } catch (err) {
      console.error(err);
      alert('Unlock failed. Please verify your Master Password.');
    }
  };

  // Unlock locked note using Biometrics
  const handleDecryptNoteWithBiometrics = async () => {
    if (!selectedNote || !selectedNote.id) return;
    try {
      const bioCredRec = await db.settings.get('vault_biometric_credential');
      if (!bioCredRec) {
        alert('Biometrics are not set up or configured.');
        return;
      }

      const success = await verifyLocalBiometrics(bioCredRec.value);
      if (success) {
        // Unlock successful!
        setUnlockedNoteIds((prev) => {
          const next = new Set(prev);
          next.add(selectedNote.id!);
          return next;
        });
      } else {
        alert('Biometric verification failed.');
      }
    } catch (err) {
      console.error(err);
      alert('Biometric unlock failed.');
    }
  };

  // Toggle active note lock status
  const handleToggleLock = async () => {
    if (!selectedNote || !selectedNote.id) return;
    
    const saltRec = await db.settings.get('vault_salt');
    if (!saltRec) {
      alert('Please set up a Master Password inside Settings or Vault to lock notes.');
      return;
    }

    const newLockedStatus = selectedNote.locked === 1 ? 0 : 1;
    
    // Update local database record
    await db.notes.update(selectedNote.id, {
      locked: newLockedStatus,
      lastModified: Date.now()
    });

    // Update active React selected note state
    setSelectedNote((prev) => {
      if (!prev) return null;
      return { ...prev, locked: newLockedStatus };
    });

    // If we just locked it, temporarily add it to unlockedNoteIds so the user can continue editing it
    if (newLockedStatus === 1) {
      setUnlockedNoteIds((prev) => {
        const next = new Set(prev);
        next.add(selectedNote.id!);
        return next;
      });
    } else {
      // If we unlocked it, remove it from the session set
      setUnlockedNoteIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedNote.id!);
        return next;
      });
    }
  };
  // Checklist insertion and toggle helper
  const handleChecklistClick = () => {
    // 1. Retrieve the saved active node and offset
    let activeNode = lastActiveNodeRef.current;
    let activeOffset = lastActiveOffsetRef.current;

    // Fallback to window selection if saved node is not connected, null, or outside the editor
    if (!activeNode || !activeNode.isConnected || !editorRef.current?.contains(activeNode)) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        activeNode = range.startContainer;
        activeOffset = range.startOffset;
      }
    }

    // Fallback: If no selection has been made yet in the editor, append a checklist item at the bottom of the editor
    if (!activeNode || !editorRef.current?.contains(activeNode)) {
      if (editorRef.current) {
        const item = document.createElement('div');
        item.innerHTML = '<input type="checkbox" style="margin-right:8px; width:16px; height:16px; vertical-align:middle; cursor:pointer;" />&nbsp;';
        editorRef.current.appendChild(item);
        setContent(editorRef.current.innerHTML);
        
        // Focus the new line
        const r = document.createRange();
        r.setStart(item, 1);
        r.collapse(true);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      return;
    }

    let originalNode = activeNode;

    // Resolve node if it points directly to the editor container
    if (originalNode === editorRef.current && editorRef.current) {
      if (editorRef.current.childNodes.length > 0) {
        const index = Math.min(activeOffset, editorRef.current.childNodes.length - 1);
        originalNode = editorRef.current.childNodes[index];
      }
    }

    let element = originalNode.nodeType === Node.TEXT_NODE ? originalNode.parentElement : originalNode as HTMLElement;
    
    // Find closest line block inside the editor
    let currentBlock = element?.closest('div, p, li') || editorRef.current;
    if (currentBlock === editorRef.current && element) {
      currentBlock = element;
    }

    // Manual, clean, robust transition of list item (li) to checklist block
    const li = currentBlock.closest('li');
    if (li) {
      const parentList = li.closest('ul, ol');
      if (parentList) {
        // Create the new checklist block (div)
        const div = document.createElement('div');
        
        // Create checkbox
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.style.marginRight = '8px';
        input.style.width = '16px';
        input.style.height = '16px';
        input.style.verticalAlign = 'middle';
        input.style.cursor = 'pointer';
        div.appendChild(input);

        // Capture caret container and offset inside the list item to preserve selection
        let savedCaretNode: Node | null = lastActiveNodeRef.current;
        let savedCaretOffset = lastActiveOffsetRef.current;

        // Move all child nodes of the li to the new div
        while (li.firstChild) {
          div.appendChild(li.firstChild);
        }

        // Make sure there is space/text node if empty so cursor has space to land
        if (div.childNodes.length === 1) {
          div.appendChild(document.createTextNode('\u00A0'));
        }

        // Now place the div in the DOM
        const childLis = Array.from(parentList.querySelectorAll('li'));
        const liIndex = childLis.indexOf(li);

        if (childLis.length === 1) {
          // Only one item: replace the entire list with the div
          parentList.parentElement?.replaceChild(div, parentList);
        } else if (liIndex === 0) {
          // First item: insert div before the list, remove li
          parentList.parentElement?.insertBefore(div, parentList);
          li.remove();
        } else if (liIndex === childLis.length - 1) {
          // Last item: insert div after the list, remove li
          parentList.parentElement?.insertBefore(div, parentList.nextSibling);
          li.remove();
        } else {
          // Middle item: split the list!
          const nextList = parentList.cloneNode(false) as HTMLElement;
          // Move remaining lis to the new list
          for (let i = liIndex + 1; i < childLis.length; i++) {
            nextList.appendChild(childLis[i]);
          }
          parentList.parentElement?.insertBefore(div, parentList.nextSibling);
          parentList.parentElement?.insertBefore(nextList, div.nextSibling);
          li.remove();
        }

        // Sync state
        if (editorRef.current) {
          setContent(editorRef.current.innerHTML);
        }

        // Restore selection inside the new div block
        const finalSelection = window.getSelection();
        if (finalSelection) {
          const finalRange = document.createRange();
          if (savedCaretNode && savedCaretNode.isConnected) {
            finalRange.setStart(savedCaretNode, savedCaretOffset);
          } else {
            finalRange.setStart(div, 1);
          }
          finalRange.collapse(true);
          finalSelection.removeAllRanges();
          finalSelection.addRange(finalRange);
        }
        return; // Done
      }
    }

    // Wrap in standard div if loose directly inside editor root
    if (currentBlock === editorRef.current) {
      document.execCommand('formatBlock', false, 'div');
      // Re-evaluate currentBlock after formatBlock
      const freshSelection = window.getSelection();
      if (freshSelection && freshSelection.rangeCount > 0) {
        const freshRange = freshSelection.getRangeAt(0);
        let n = freshRange.startContainer;
        let el = n.nodeType === Node.TEXT_NODE ? n.parentElement : n as HTMLElement;
        while (el && el !== editorRef.current) {
          const tagName = el.tagName.toLowerCase();
          if (['div', 'p', 'li'].includes(tagName)) {
            if (el.isConnected) {
              currentBlock = el;
              break;
            }
          }
          el = el.parentElement;
        }
      }
    }

    if (!currentBlock || currentBlock === editorRef.current) return;

    // Capture the exact cursor position before checklist block modification (to preserve caret offset/location)
    const activeSel = window.getSelection();
    let savedContainer: Node | null = null;
    let savedOffset: number = 0;
    if (activeSel && activeSel.rangeCount > 0) {
      const r = activeSel.getRangeAt(0);
      savedContainer = r.startContainer;
      savedOffset = r.startOffset;
    }

    // Toggle checklist checkbox on/off directly via DOM elements
    const existingCheckbox = currentBlock.querySelector('input[type="checkbox"]');
    let checkboxAction: 'added' | 'removed' = 'added';

    if (existingCheckbox) {
      existingCheckbox.remove();
      checkboxAction = 'removed';
    } else {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.style.marginRight = '8px';
      input.style.width = '16px';
      input.style.height = '16px';
      input.style.verticalAlign = 'middle';
      input.style.cursor = 'pointer';

      // Prepend checkbox to block
      currentBlock.insertBefore(input, currentBlock.firstChild);
      
      // Make sure block is not empty so cursor has space to land
      if (currentBlock.childNodes.length === 1) {
        currentBlock.appendChild(document.createTextNode('\u00A0'));
      }
      checkboxAction = 'added';
    }

    // Restore exact cursor position or offset it if container was the block itself
    const finalSelection = window.getSelection();
    if (finalSelection && savedContainer && savedContainer.isConnected) {
      const finalRange = document.createRange();
      
      if (savedContainer === currentBlock) {
        // If container is the block itself, adjust offset for the added/removed checkbox child
        let newOffset = savedOffset;
        if (checkboxAction === 'added') {
          newOffset = savedOffset + 1;
        } else {
          newOffset = Math.max(0, savedOffset - 1);
        }
        finalRange.setStart(currentBlock, newOffset);
      } else {
        // Container is a text node or an inline element inside the block; its offset remains unchanged
        finalRange.setStart(savedContainer, savedOffset);
      }
      
      finalRange.collapse(true);
      finalSelection.removeAllRanges();
      finalSelection.addRange(finalRange);
    } else if (finalSelection) {
      // Fallback: place caret after the checkbox
      const finalRange = document.createRange();
      finalRange.setStart(currentBlock, checkboxAction === 'added' ? 1 : 0);
      finalRange.collapse(true);
      finalSelection.removeAllRanges();
      finalSelection.addRange(finalRange);
    }

    if (editorRef.current) {
      setContent(editorRef.current.innerHTML);
    }
  };

  // Helper: check if a DOM node is a deletable media/file block
  const getMediaNode = (node: Node | null): HTMLElement | null => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as HTMLElement;
    if (el.classList.contains('media-wrapper')) return el;
    if (el.classList.contains('embedded-file-card')) return el;
    return null;
  };

  // Listen for Enter key and Backspace/Delete near media blocks
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
      const range = sel.getRangeAt(0);

      // Only act when nothing is selected (collapsed cursor)
      if (!range.collapsed) return;

      const { startContainer, startOffset } = range;

      // Case 1: cursor is directly inside the editor root div
      if (startContainer === editorRef.current) {
        const targetIndex = e.key === 'Backspace' ? startOffset - 1 : startOffset;
        if (targetIndex >= 0 && targetIndex < editorRef.current.childNodes.length) {
          const candidate = getMediaNode(editorRef.current.childNodes[targetIndex]);
          if (candidate) {
            e.preventDefault();
            deleteMediaNode(candidate);
            return;
          }
        }
      }

      // Case 2: cursor inside a text/element node — walk UP the DOM from the cursor,
      // checking at every level whether the prev/next sibling is a media node.
      // This catches both direct-editor-child and deeply nested scenarios.
      if (e.key === 'Backspace') {
        // Walk up, checking previous sibling at each level
        let current: Node | null = startContainer;
        let offset = startOffset;

        while (current && current !== editorRef.current) {
          // We're "at the start" of `current` if offset is 0 and there's no previous
          // non-empty text node within the current node before the cursor.
          const atStart = offset === 0 &&
            (current === startContainer ||
              // travelling up: we entered this node from its first child
              current.nodeType === Node.ELEMENT_NODE);

          if (atStart) {
            const prevSib = (current as HTMLElement).previousElementSibling as HTMLElement | null;
            const candidate = getMediaNode(prevSib);
            if (candidate) {
              e.preventDefault();
              deleteMediaNode(candidate);
              return;
            }
          }

          // Move up: the offset into the parent is the child index of current
          const parent: Node | null = current.parentNode;
          if (parent) {
            const children = Array.from(parent.childNodes);
            offset = children.indexOf(current as ChildNode);
          }
          current = parent;
        }
      }

      if (e.key === 'Delete') {
        // Walk up, checking next sibling at each level
        let current: Node | null = startContainer;

        while (current && current !== editorRef.current) {
          // "at the end" of current means cursor is at the very end of its content
          let atEnd = false;
          if (current === startContainer) {
            if (current.nodeType === Node.TEXT_NODE) {
              atEnd = startOffset === (current as Text).length;
            } else {
              atEnd = startOffset === current.childNodes.length;
            }
          } else {
            // Coming up from a child — we're at the end if it was the last child
            const parent = current.parentNode;
            if (parent) {
              atEnd = current === parent.lastChild;
            }
          }

          if (atEnd) {
            const nextSib = (current as HTMLElement).nextElementSibling as HTMLElement | null;
            const candidate = getMediaNode(nextSib);
            if (candidate) {
              e.preventDefault();
              deleteMediaNode(candidate);
              return;
            }
          }

          current = current.parentNode;
        }
      }
    }


    if (e.key === 'Enter') {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      let node = range.startContainer;
      let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
      
      const currentBlock = element?.closest('div, p, li');
      const hasCheckbox = currentBlock && currentBlock.querySelector('input[type="checkbox"]');
      
      if (hasCheckbox) {
        // Let the browser perform standard splitting of the block.
        // Immediately after on next tick, handle the new line block creation.
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          
          const r = sel.getRangeAt(0);
          let n = r.startContainer;
          let el = n.nodeType === Node.TEXT_NODE ? n.parentElement : n as HTMLElement;
          const newBlock = el?.closest('div, p, li');
          
          if (newBlock) {
            const box = newBlock.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (box) {
              // Reset checkbox state to unchecked if browser duplicated it from previous line
              box.checked = false;
              box.removeAttribute('checked');

              // Move cursor/selection after the duplicated checkbox!
              const newSelection = window.getSelection();
              if (newSelection) {
                const newRange = document.createRange();
                newRange.setStart(newBlock, 1);
                newRange.collapse(true);
                newSelection.removeAllRanges();
                newSelection.addRange(newRange);
              }
            } else {
              // Insert checkbox at start of new line block if not duplicated
              const checkboxHTML = '<input type="checkbox" style="margin-right:8px; width:16px; height:16px; vertical-align:middle; cursor:pointer;"  /> ';
              const r2 = document.createRange();
              r2.setStart(newBlock, 0);
              r2.collapse(true);
              const frag = r2.createContextualFragment(checkboxHTML);
              newBlock.insertBefore(frag, newBlock.firstChild);

              // Move cursor/selection after the newly inserted checkbox!
              const newSelection = window.getSelection();
              if (newSelection) {
                const newRange = document.createRange();
                newRange.setStart(newBlock, 1);
                newRange.collapse(true);
                newSelection.removeAllRanges();
                newSelection.addRange(newRange);
              }
            }
            
            // Sync state
            if (editorRef.current) {
              setContent(editorRef.current.innerHTML);
            }
          }
        }, 0);
      }
    }
  };

  // Debounced auto-save logic
  useEffect(() => {
    if (!selectedNote) return;

    const timer = setTimeout(async () => {
      await db.notes.update(selectedNote.id!, {
        title,
        content,
        paths,
        lastModified: Date.now()
      });
    }, 600);

    return () => {
      clearTimeout(timer);
      const previousNoteId = selectedNote.id;
      const isSwitchingOrUnmounting = currentNoteIdRef.current !== previousNoteId;
      if (isSwitchingOrUnmounting && previousNoteId) {
        db.notes.update(previousNoteId, {
          title: titleRef.current,
          content: contentRef.current,
          paths: pathsRef.current,
          lastModified: Date.now()
        });
      }
    };
  }, [title, content, paths, selectedNote]);

  const handleCreateNote = async () => {
    const newNote: NoteRecord = {
      title: 'Untitled Note',
      content: '',
      paths: [],
      pinned: 0,
      lastModified: Date.now()
    };
    const id = await db.notes.add(newNote);
    setSelectedNote({ ...newNote, id });
  };

  const handleDeleteNote = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this note?')) {
      await db.notes.delete(id);
      if (selectedNote?.id === id) {
        setSelectedNote(null);
      }
    }
  };

  const handleTogglePin = async (note: NoteRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.notes.update(note.id!, {
      pinned: note.pinned === 1 ? 0 : 1,
      lastModified: Date.now()
    });
    if (selectedNote && selectedNote.id === note.id) {
      setSelectedNote({ ...selectedNote, pinned: note.pinned === 1 ? 0 : 1 });
    }
  };

  // Helper to delete sketches that intersect with the eraser coordinate (Vector-based eraser)
  const erasePathsAtPoint = (x: number, y: number) => {
    setPaths((prevPaths) => {
      let changed = false;
      const nextPaths = prevPaths.filter((path) => {
        // Threshold for distance check is based on stroke width + margin
        const threshold = Math.max(12, path.widthDp + 8);
        const isNear = path.points.some((pt) => {
          const dx = pt.x - x;
          const dy = pt.y - y;
          return dx * dx + dy * dy < threshold * threshold;
        });

        if (isNear) {
          changed = true;
          return false; // Filter this path out (erases it)
        }
        return true; // Keep this path
      });

      return changed ? nextPaths : prevPaths;
    });
  };

  // Canvas drawing handlers
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawingMode || !canvasRef.current) return;
    
    setIsDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isEraser) {
      erasePathsAtPoint(x, y);
    } else {
      const newPoint: Point = { x, y };
      const newPath: DrawingPath = {
        points: [newPoint],
        colorArgb: hexToArgb(strokeColor),
        widthDp: strokeWidth
      };
      setPaths((prev) => [...prev, newPath]);
      setRedoPaths([]);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing || !isDrawingMode || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isEraser) {
      erasePathsAtPoint(x, y);
    } else {
      if (paths.length === 0) return;
      const newPoint: Point = { x, y };
      setPaths((prev) => {
        const next = [...prev];
        const activePath = { ...next[next.length - 1] };
        activePath.points = [...activePath.points, newPoint];
        next[next.length - 1] = activePath;
        return next;
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleClearDrawing = () => {
    if (window.confirm('Clear all drawing strokes?')) {
      setPaths([]);
      setRedoPaths([]);
    }
  };

  const handleUndoStroke = () => {
    if (paths.length === 0) return;
    const lastPath = paths[paths.length - 1];
    setRedoPaths((prev) => [...prev, lastPath]);
    setPaths((prev) => prev.slice(0, -1));
  };

  const handleRedoStroke = () => {
    if (redoPaths.length === 0) return;
    const nextPath = redoPaths[redoPaths.length - 1];
    setRedoPaths((prev) => prev.slice(0, -1));
    setPaths((prev) => [...prev, nextPath]);
  };

  const filteredNotes: NoteRecord[] = notes.filter((note: NoteRecord) => 
    note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    note.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ height: 'calc(100vh - 160px)' }}>
      {/* Sidebar List */}
      {!selectedNote && (
        <div className="notes-sidebar-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', height: '100%' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flexGrow: 1,
              padding: '12px 16px',
              borderRadius: 'var(--border-radius-md)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-surface)'
            }}
          />
          <button className="btn-primary" onClick={handleCreateNote} style={{ padding: '12px 14px' }}>
            +
          </button>
        </div>

        <div 
          className="items-list"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '20px',
            alignContent: 'flex-start'
          }}
        >
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              className="item-card"
              onClick={() => setSelectedNote(note)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}
            >
              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {note.locked === 1 && <span>🔒</span>}
                  <span>{note.title || 'Untitled Note'}</span>
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={(e) => handleTogglePin(note, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: note.pinned === 1 ? 'var(--accent)' : 'var(--text-tertiary)' }}
                  >
                    📌
                  </button>
                  <button 
                    onClick={(e) => handleDeleteNote(note.id!, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                {new Date(note.lastModified).toLocaleDateString()}
              </span>
            </div>
          ))}
          {filteredNotes.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-tertiary)', padding: '40px 0' }}>
              No notes found
            </div>
          )}
        </div>
      </div>
    )}

      {/* Editor Screen */}
      {selectedNote && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className={`note-workspace ${isDrawingMode ? 'drawing-mode-active' : ''}`}>
            <div className="note-toolbar">
              <button 
                className="toolbar-btn" 
                onClick={() => setSelectedNote(null)}
                title="Back to List"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  fontWeight: 600, 
                  backgroundColor: 'var(--accent-soft)', 
                  color: 'var(--accent)',
                  border: '1px solid var(--accent-border)',
                  marginRight: '8px',
                  width: 'auto',
                  padding: '0 12px'
                }}
              >
              <span>←</span> Back
              </button>

              {(selectedNote.locked !== 1 || unlockedNoteIds.has(selectedNote.id!)) && (
                <>
                  <button 
                    className={`toolbar-btn ${isDrawingMode ? 'active' : ''}`} 
                    onClick={() => setIsDrawingMode(!isDrawingMode)}
                    title="Toggle Drawing Canvas"
                    disabled={isRecording}
                    style={{ opacity: isRecording ? 0.5 : 1 }}
                  >
                    🎨
                  </button>
                  {!isDrawingMode && !isRecording && (
                    <div style={{ position: 'relative' }}>
                      <button 
                        className={`toolbar-btn ${isAttachDropdownOpen ? 'active' : ''}`} 
                        onClick={() => setIsAttachDropdownOpen(!isAttachDropdownOpen)}
                        title="Attach File or Media"
                      >
                        📎
                      </button>
                      
                      {isAttachDropdownOpen && (
                        <div className="attachment-dropdown">
                          <button 
                            className="dropdown-item" 
                            onClick={() => photoInputRef.current?.click()}
                          >
                            <span className="dropdown-item-icon">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <polyline points="21 15 16 10 5 21" />
                              </svg>
                            </span>
                            Choose Photo or Video
                          </button>
                          <button 
                            className="dropdown-item" 
                            onClick={startAudioRecording}
                          >
                            <span className="dropdown-item-icon">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v4M8 23h8" />
                              </svg>
                            </span>
                            Record Audio
                          </button>
                          <button 
                            className="dropdown-item" 
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <span className="dropdown-item-icon">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                              </svg>
                            </span>
                            Attach File
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {isRecording ? (
                    <div className="recording-stopwatch-bar">
                      <div className="recording-indicator">
                        <span className="recording-dot"></span>
                        <span className="recording-text">Recording...</span>
                      </div>
                      <span className="recording-timer">{formatTime(recordingSeconds)}</span>
                      <button 
                        className="toolbar-btn" 
                        onClick={() => stopAudioRecording(true)}
                        title="Save Voice Recording"
                        style={{ color: '#4caf50', fontSize: '18px', fontWeight: 'bold' }}
                      >
                        ✔️
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onClick={() => stopAudioRecording(false)}
                        title="Cancel Recording"
                        style={{ color: '#f44336', fontSize: '18px', fontWeight: 'bold' }}
                      >
                        ❌
                      </button>
                    </div>
                  ) : isDrawingMode ? (
                    <>
                      <input 
                        type="color" 
                        value={strokeColor} 
                        onChange={(e) => {
                          setStrokeColor(e.target.value);
                          setIsEraser(false);
                        }} 
                        style={{ 
                          width: '32px', 
                          height: '32px', 
                          border: 'none', 
                          cursor: 'pointer', 
                          borderRadius: '4px', 
                          backgroundColor: 'transparent',
                          opacity: isEraser ? 0.4 : 1,
                          transition: 'opacity 0.2s'
                        }}
                        disabled={isEraser}
                        title="Brush Color"
                      />
                      <button 
                        className={`toolbar-btn ${isEraser ? 'active' : ''}`} 
                        onClick={() => setIsEraser(!isEraser)}
                        title="Toggle Eraser Mode"
                      >
                        🧽
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <span>Size:</span>
                        <input 
                          type="range" 
                          min="1" 
                          max="24" 
                          value={strokeWidth} 
                          onChange={(e) => setStrokeWidth(Number(e.target.value))}
                          style={{ 
                            width: '90px', 
                            accentColor: 'var(--accent)', 
                            cursor: 'pointer',
                            verticalAlign: 'middle'
                          }}
                        />
                        <span style={{ fontWeight: 600, minWidth: '32px' }}>{strokeWidth}px</span>
                      </div>
                      <button className="toolbar-btn" onClick={handleUndoStroke} title="Undo Stroke">
                        ↩️
                      </button>
                      <button className="toolbar-btn" onClick={handleRedoStroke} title="Redo Stroke">
                        ↪️
                      </button>
                      <button className="toolbar-btn" onClick={handleClearDrawing} title="Clear Sketch">
                        🗑️
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('bold'); }} 
                        title="Bold"
                      >
                        <b>B</b>
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('italic'); }} 
                        title="Italic"
                      >
                        <i>I</i>
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('underline'); }} 
                        title="Underline"
                      >
                        <u>U</u>
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('insertUnorderedList'); }} 
                        title="Bullet List"
                      >
                        •=
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('insertOrderedList'); }} 
                        title="Numbered List"
                      >
                        1=
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); handleChecklistClick(); }} 
                        title="Add Checklist Box"
                      >
                        ☑️
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('undo'); }} 
                        title="Undo Text Edit"
                      >
                        ↩️
                      </button>
                      <button 
                        className="toolbar-btn" 
                        onMouseDown={(e) => { e.preventDefault(); formatText('redo'); }} 
                        title="Redo Text Edit"
                      >
                        ↪️
                      </button>
                    </>
                  )}
                </>
              )}

              <div style={{ flexGrow: 1 }} />

              <button 
                className={`toolbar-btn ${selectedNote.locked === 1 ? 'active' : ''}`}
                onClick={handleToggleLock}
                title={selectedNote.locked === 1 ? "Decrypt & Make Public" : "Lock with Master Password"}
                style={{ marginRight: '4px' }}
              >
                {selectedNote.locked === 1 ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                )}
              </button>
            </div>
 
            {/* Note Area */}
            <div className="editor-interactive-area">
              {selectedNote.locked === 1 && !unlockedNoteIds.has(selectedNote.id!) ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  padding: '40px',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                  gap: '24px'
                }}>
                  <div style={{ fontSize: '64px' }}>🔒</div>
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                      Secure Locked Note
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '360px', margin: '0 auto', lineHeight: '1.5' }}>
                      This note is encrypted. Please enter your Master Password or use biometrics to decrypt and view it.
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '320px', marginTop: '10px' }}>
                    <input
                      type="password"
                      placeholder="Master Password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleDecryptNoteWithPassword();
                        }
                      }}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 'var(--border-radius-md)',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-base)',
                        color: 'var(--text-primary)',
                        fontSize: '16px',
                        outline: 'none',
                        textAlign: 'center'
                      }}
                    />
                    
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        className="btn-primary" 
                        onClick={handleDecryptNoteWithPassword}
                        style={{ flexGrow: 1, padding: '12px' }}
                      >
                        Decrypt Note
                      </button>

                      {hasBiometrics && (
                        <button 
                          className="toolbar-btn" 
                          onClick={handleDecryptNoteWithBiometrics}
                          title="Unlock with Biometrics"
                          style={{
                            width: '46px',
                            height: '46px',
                            backgroundColor: 'var(--accent-soft)',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent-border)',
                            borderRadius: 'var(--border-radius-md)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          🧬
                        </button>
                      )}
                    </div>
                  </div>

                  {!hasMasterPassword && (
                    <p style={{ fontSize: '12px', color: 'var(--accent)', maxWidth: '300px', margin: '0 auto' }}>
                      ⚠️ Master password is not set up yet. Go to Settings or Vault to create one.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    style={{
                      position: 'relative',
                      fontSize: '24px',
                      fontWeight: 800,
                      fontFamily: 'var(--font-heading)',
                      padding: '24px 30px 10px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: 'var(--text-primary)',
                      width: '100%',
                      zIndex: 3
                    }}
                  />
                  
                  <div
                    ref={editorRef}
                    contentEditable={!isDrawingMode}
                    onInput={(e) => {
                      setContent(e.currentTarget.innerHTML);
                      updateLastActiveSelection();
                    }}
                    onKeyDown={handleKeyDown}
                    onKeyUp={updateLastActiveSelection}
                    onClick={(e) => {
                      updateLastActiveSelection();
                      const target = e.target as HTMLElement;

                      // Capture click on file card to download it
                      const fileCard = target.closest('.embedded-file-card');
                      if (fileCard) {
                        e.preventDefault();
                        e.stopPropagation();
                        const name = fileCard.getAttribute('data-file-name') || 'download';
                        const data = fileCard.getAttribute('data-file-data');
                        if (data) {
                          const link = document.createElement('a');
                          link.href = data;
                          link.download = name;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }
                        return;
                      }

                      // Capture direct click on checklists to save state immediately
                      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
                        const checkbox = target as HTMLInputElement;
                        if (checkbox.checked) {
                          checkbox.setAttribute('checked', 'checked');
                        } else {
                          checkbox.removeAttribute('checked');
                        }
                        if (editorRef.current) {
                          setContent(editorRef.current.innerHTML);
                        }
                      }
                    }}
                    data-placeholder="Start typing your note here..."
                    className="text-editor-field"
                    style={{ zIndex: 1 }}
                  />

                  {/* Drawing SVG Overlay */}
                  <svg
                    ref={canvasRef}
                    className={`drawing-canvas-overlay ${isDrawingMode ? 'active' : ''}`}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                  >
                    {paths.map((path, index) => (
                      <path
                        key={index}
                        d={pointsToSvgPath(path.points)}
                        fill="none"
                        stroke={path.colorArgb === 0 ? 'var(--bg-surface)' : argbToHex(path.colorArgb)}
                        style={{ stroke: path.colorArgb === 0 ? 'var(--bg-surface)' : argbToHex(path.colorArgb) }}
                        strokeWidth={path.widthDp}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </svg>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Hidden file inputs for photo/video and universal files */}
      <input 
        type="file" 
        ref={photoInputRef} 
        onChange={handlePhotoVideoUpload} 
        accept="image/*,video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv,.m4v,.mov" 
        style={{ display: 'none' }} 
      />
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept="*/*" 
        style={{ display: 'none' }} 
      />
    </div>
  );
}

// Convert drawing coordinate points list to SVG path string
function pointsToSvgPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

// Helper: Hex color to ARGB number
function hexToArgb(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return (0xFF << 24) | (r << 16) | (g << 8) | b;
}

// Helper: ARGB number to Hex color
function argbToHex(argb: number): string {
  const r = (argb >> 16) & 0xFF;
  const g = (argb >> 8) & 0xFF;
  const b = argb & 0xFF;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
