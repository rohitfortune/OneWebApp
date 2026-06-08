import { useState, useEffect } from 'react';
import { setGlobalDialogHandlers } from '../utils/dialogs';

export default function GlobalDialogs() {
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: 'alert' | 'prompt';
    title: string;
    message: string;
    resolve: ((value: string | null) => void) | null;
  }>({
    isOpen: false,
    type: 'alert',
    title: '',
    message: '',
    resolve: null
  });
  
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    setGlobalDialogHandlers(
      (message: string, title?: string) => {
        return new Promise((resolve) => {
          setDialog({ isOpen: true, type: 'alert', title: title || 'Notice', message, resolve: () => resolve() });
        });
      },
      (message: string, title?: string) => {
        return new Promise((resolve) => {
          setInputValue('');
          setDialog({ isOpen: true, type: 'prompt', title: title || 'Authentication Required', message, resolve });
        });
      }
    );
  }, []);

  if (!dialog.isOpen) return null;

  const handleClose = (value: string | null) => {
    setDialog(prev => ({ ...prev, isOpen: false }));
    if (dialog.resolve) dialog.resolve(value);
  };

  return (
    <div className="dialog-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 99999, 
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div className="dialog-card" style={{
        backgroundColor: 'var(--bg-surface)', padding: '24px', 
        borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-xl)', 
        maxWidth: '400px', width: '90%', display: 'flex', flexDirection: 'column', gap: '16px',
        animation: 'slideUp 0.2s ease-out'
      }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', color: 'var(--text-primary)' }}>
          {dialog.title}
        </h3>
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          {dialog.message}
        </p>
        
        {dialog.type === 'prompt' && (
          <input 
            type="password" 
            autoFocus
            value={inputValue} 
            onChange={(e) => setInputValue(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleClose(inputValue)}
            style={{ 
              padding: '12px', borderRadius: 'var(--border-radius-md)', 
              border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)', 
              color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box'
            }}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
          {dialog.type === 'prompt' && (
            <button className="btn-secondary" onClick={() => handleClose(null)}>Cancel</button>
          )}
          <button className="btn-primary" onClick={() => handleClose(dialog.type === 'prompt' ? inputValue : null)}>
            {dialog.type === 'prompt' ? 'Submit' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
