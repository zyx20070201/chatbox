import React, { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { formatMessageTime } from '../utils';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function MentionsPanel({ onClose, token, currentUser, socket, onJump }) {
  const [mentions, setMentions] = useState([]);

  useEffect(() => {
    fetch(`${SOCKET_URL}/api/mentions?unreadOnly=true`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
          if (Array.isArray(data)) setMentions(data);
      })
      .catch(console.error);
  }, [token]);

  useEffect(() => {
      if (!socket) return;
      
      // Update local list if we mark something as read elsewhere
      const handleMyMentionUpdate = (updatedMention) => {
          if (updatedMention.isRead) {
              setMentions(prev => prev.filter(m => m.id !== updatedMention.id));
          }
      };
      
      const handleNewMessage = (msg) => {
          if (msg.isDeleted) return; // Don't show deleted messages in mentions panel
          // Check if I am mentioned in the new message
          const myMention = msg.mentions?.find(m => Number(m.userId) === Number(currentUser.id));
          if (myMention) {
              const newEntry = {
                  ...myMention,
                  message: msg
              };
              setMentions(prev => {
                  if (prev.some(m => m.id === myMention.id)) return prev;
                  return [newEntry, ...prev];
              });
          }
      };

      const handleMessageUpdated = (msg) => {
          setMentions(prev => {
              const myMention = msg.mentions?.find(men => Number(men.userId) === Number(currentUser.id));
              const exists = prev.some(m => m.messageId === msg.id);

              if (myMention && !myMention.isRead) {
                  if (exists) {
                      return prev.map(m => m.messageId === msg.id ? { ...myMention, message: msg } : m);
                  } else {
                      return [ { ...myMention, message: msg }, ...prev ];
                  }
              } else {
                  return prev.filter(m => m.messageId !== msg.id);
              }
          });
      };

      const handleMessageDeleted = ({ messageId }) => {
          setMentions(prev => {
              const toRemove = prev.find(m => m.messageId === messageId);
              // Decrement count if the removed mention was unread
              if (toRemove && !toRemove.isRead) {
                  // This is handled by ChatRoom.jsx's global handler too, 
                  // but MentionsPanel needs to update its local list.
              }
              return prev.filter(m => m.messageId !== messageId);
          });
      };
      
      const handleRestore = (restoredMsg) => {
          const myMention = restoredMsg.mentions?.find(m => Number(m.userId) === Number(currentUser.id));
          if (myMention && !myMention.isRead) {
              setMentions(prev => {
                  if (prev.some(m => m.id === myMention.id)) return prev;
                  return [ { ...myMention, message: restoredMsg }, ...prev ];
              });
          }
      };
      
      socket.on('my_mention_updated', handleMyMentionUpdate);
      socket.on('new_message', handleNewMessage);
      socket.on('message_updated', handleMessageUpdated);
      socket.on('message_deleted', handleMessageDeleted);
      socket.on('message_restored', handleRestore);

      return () => {
          socket.off('my_mention_updated', handleMyMentionUpdate);
          socket.off('new_message', handleNewMessage);
          socket.off('message_updated', handleMessageUpdated);
          socket.off('message_deleted', handleMessageDeleted);
          socket.off('message_restored', handleRestore);
      };
  }, [socket, currentUser.id]);

  const handleMarkRead = (e, mention) => {
      e.stopPropagation();
      socket.emit('mark_mention_read', { mentionId: mention.id });
      // Optimistic update
      setMentions(prev => prev.filter(m => m.id !== mention.id));
  };

  return (
    <div className="w-80 flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-30 transition-all">
      <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <h3 className="font-bold text-gray-800 dark:text-gray-200">Unread Mentions</h3>
        <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {mentions.length === 0 && (
            <div className="text-gray-500 text-center mt-10 text-sm">No unread mentions.</div>
        )}
        {mentions.map(mention => (
          <div 
            key={mention.id} 
            onClick={() => onJump(mention.messageId)}
            className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition relative group"
          >
            <div className="flex items-center gap-2 mb-1">
                <div className="font-bold text-xs text-blue-600 dark:text-blue-400">{mention.message?.user?.username || 'Unknown'}</div>
                <div className="text-[10px] text-gray-400">{formatMessageTime(mention.createdAt)}</div>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                {mention.message?.content ? (
                    <div dangerouslySetInnerHTML={{__html: mention.message.content}} />
                ) : (
                    <span className="italic text-gray-500">
                        {mention.message?.type === 'image' ? '[Image]' : mention.message?.type === 'file' ? '[File]' : '[Attachment]'}
                    </span>
                )}
            </div>
            
            <button 
                onClick={(e) => handleMarkRead(e, mention)}
                className="absolute top-2 right-2 p-1 bg-white dark:bg-gray-800 rounded-full shadow-sm text-gray-400 hover:text-green-500 opacity-0 group-hover:opacity-100 transition"
                title="Mark as Read"
            >
                <Check size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
