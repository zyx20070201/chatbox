import React, { useEffect, useState } from 'react';
import { X, Image as ImageIcon, FileText, Download } from 'lucide-react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function FileVaultPanel({ onClose, token, socket }) {
  const [activeTab, setActiveTab] = useState('media'); // 'media' | 'file'
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${SOCKET_URL}/api/files?type=${activeTab}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setFiles(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [activeTab, token]);

  useEffect(() => {
      if (!socket) return;

      const handleNewMessage = (msg) => {
          if (msg.attachments && msg.attachments.length > 0) {
              const newFiles = msg.attachments.filter(att => {
                  if (activeTab === 'media') return att.mimeType.startsWith('image/');
                  if (activeTab === 'file') return !att.mimeType.startsWith('image/');
                  return false;
              }).map(att => ({ ...att, message: msg }));
              
              if (newFiles.length > 0) {
                  setFiles(prev => [...newFiles, ...prev]);
              }
          }
      };

      const handleMessageDeleted = ({ messageId }) => {
          setFiles(prev => prev.filter(f => f.messageId !== messageId));
      };

      const handleRestore = (restoredMsg) => {
          if (restoredMsg.attachments && restoredMsg.attachments.length > 0) {
               const restoredFiles = restoredMsg.attachments.filter(att => {
                  if (activeTab === 'media') return att.mimeType.startsWith('image/');
                  if (activeTab === 'file') return !att.mimeType.startsWith('image/');
                  return false;
               }).map(att => ({ ...att, message: restoredMsg }));

               setFiles(prev => {
                   const existingIds = new Set(prev.map(f => f.id));
                   const uniqueNew = restoredFiles.filter(f => !existingIds.has(f.id));
                   // Insert and sort
                   const newList = [...uniqueNew, ...prev];
                   return newList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
               });
          }
      };

      socket.on('new_message', handleNewMessage);
      socket.on('message_deleted', handleMessageDeleted);
      socket.on('message_restored', handleRestore);

      return () => {
          socket.off('new_message', handleNewMessage);
          socket.off('message_deleted', handleMessageDeleted);
          socket.off('message_restored', handleRestore);
      };
  }, [socket, activeTab]);

  return (
    <div className="w-96 flex flex-col bg-white border-l border-gray-200 shadow-2xl z-30 transition-all">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="font-bold text-gray-800">File Vault</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={20} /></button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button 
          onClick={() => setActiveTab('media')}
          className={`flex-1 p-3 text-sm font-medium transition ${activeTab === 'media' ? 'text-blue-600 border-b-2 border-blue-600 bg-gray-50' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
        >
          Media
        </button>
        <button 
          onClick={() => setActiveTab('file')}
          className={`flex-1 p-3 text-sm font-medium transition ${activeTab === 'file' ? 'text-blue-600 border-b-2 border-blue-600 bg-gray-50' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
        >
          Files
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {loading && <div className="text-center text-gray-500 mt-10">Loading...</div>}
        
        {!loading && files.length === 0 && (
            <div className="text-center text-gray-500 mt-10">No {activeTab} found.</div>
        )}

        {/* Media Grid */}
        {!loading && activeTab === 'media' && (
            <div className="grid grid-cols-3 gap-2">
                {files.map(file => (
                    <div key={file.id} className="aspect-square relative group cursor-pointer" onClick={() => window.open(`${SOCKET_URL}${file.originalUrl || file.url}`, '_blank')}>
                        <img src={`${SOCKET_URL}${file.url}`} alt={file.filename} className="w-full h-full object-cover rounded border border-gray-200" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                            <Download className="text-white" size={20} />
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* File List */}
        {!loading && activeTab === 'file' && (
            <div className="flex flex-col gap-2">
                {files.map(file => (
                    <div key={file.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded border border-gray-200 hover:border-gray-300 transition">
                        <div className="p-2 bg-gray-200 rounded text-blue-500">
                            <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="truncate text-sm font-medium text-gray-800">{file.filename}</div>
                            <div className="text-xs text-gray-500 flex justify-between">
                                <span>{(file.size / 1024).toFixed(1)} KB</span>
                                <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">By {file.message?.user?.username}</div>
                        </div>
                        <a href={`${SOCKET_URL}${file.url}`} download={file.filename} className="text-gray-400 hover:text-gray-600 p-1">
                            <Download size={16} />
                        </a>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
}
