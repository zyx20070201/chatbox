import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import MessageBubble from './MessageBubble';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function BookmarksPanel({ onClose, token, currentUser, socket, onShowToast }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${SOCKET_URL}/api/bookmarks`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
          if (Array.isArray(data)) {
              setBookmarks(data);
          } else {
              console.error("Failed to load bookmarks:", data);
              setBookmarks([]);
          }
          setLoading(false);
      })
      .catch(e => {
          console.error("Fetch bookmarks error:", e);
          setBookmarks([]);
          setLoading(false);
      });
  }, [token]);

  useEffect(() => {
      if (!socket) return;

      const handleUpdate = (updatedMsg) => {
          if (!updatedMsg) return;
          setBookmarks(prev => prev.map(b => {
              if (b && b.id === updatedMsg.id) return updatedMsg;
              if (b && b.parent && b.parent.id === updatedMsg.id) {
                  return { ...b, parent: updatedMsg };
              }
              return b;
          }));
      };

      const handleDelete = ({ messageId }) => {
          if (!messageId) return;
          setBookmarks(prev => {
              // 1. Remove the deleted message itself
              const filtered = prev.filter(b => b && b.id !== messageId);
              
              // 2. Update any message that replies to the deleted message (Quote Sync)
              return filtered.map(b => {
                  if (b && b.parent && Number(b.parent.id) === Number(messageId)) {
                      return { ...b, parent: { ...b.parent, isDeleted: true } };
                  }
                  return b;
              });
          });
      };

      const handleRestore = (restoredMsg) => {
          if (!restoredMsg) return;
          setBookmarks(prev => {
              // If the restored message belongs here (is bookmarked), we should ideally add it back.
              // However, the backend 'bookmark_updated' event usually handles this.
              // For now, ensure no crash if we map over nulls.
              return prev.map(b => {
                  if (!b) return b;
                  if (b.parent && Number(b.parent.id) === Number(restoredMsg.id)) {
                      return { ...b, parent: restoredMsg };
                  }
                  return b;
              });
          });
      };

      const handleMyMentionUpdate = (updatedMention) => {
          if (!updatedMention) return;
          setBookmarks(prev => prev.map(b => {
              if (b && b.id === updatedMention.messageId && b.mentions) {
                  return {
                      ...b,
                      mentions: b.mentions.map(m => m.id === updatedMention.id ? updatedMention : m)
                  };
              }
              return b;
          }));
      };

      const handleBookmarkUpdate = ({ message, bookmarked }) => {
          if (!message) return;
          if (bookmarked) {
              setBookmarks(prev => {
                  if (prev.find(b => b && b.id === message.id)) return prev;
                  return [message, ...prev].sort((a, b) => {
                      const t1 = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                      const t2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                      return t2 - t1; // Descending
                  });
              });
          } else {
              setBookmarks(prev => prev.filter(b => b && b.id !== message.id));
          }
      };

      socket.on('message_updated', handleUpdate);
      socket.on('message_deleted', handleDelete);
      socket.on('message_restored', handleRestore);
      socket.on('bookmark_updated', handleBookmarkUpdate);
      socket.on('my_mention_updated', handleMyMentionUpdate);

      return () => {
          socket.off('message_updated', handleUpdate);
          socket.off('message_deleted', handleDelete);
          socket.off('message_restored', handleRestore);
          socket.off('bookmark_updated', handleBookmarkUpdate);
          socket.off('my_mention_updated', handleMyMentionUpdate);
      };
  }, [socket]);

  return (
    <div className="w-96 flex flex-col bg-white border-l border-gray-200 shadow-2xl z-30 transition-all overflow-hidden">
      {/* Header */}
      <div className="flex-none flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="font-bold text-gray-800">My Bookmarks</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors"><X size={20} /></button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
        {loading ? (
            <div className="text-center text-gray-500 mt-10">Loading bookmarks...</div>
        ) : bookmarks.length === 0 ? (
            <div className="text-gray-500 text-center mt-10">No bookmarks yet.</div>
        ) : (
            bookmarks.map(msg => {
                // 过滤掉无效数据或已被删除的消息
                if (!msg || msg.isDeleted) return null;

                return (
                  <MessageBubble 
                    key={msg.id} 
                    message={msg} 
                    isMe={currentUser && Number(msg.userId || msg.user?.id) === Number(currentUser.id)} 
                    currentUser={currentUser} 
                    socket={socket} 
                    showAvatar={true}
                    onReply={()=>{}} // 收藏夹通常不支持直接回复，传空函数
                    onShowToast={onShowToast}
                    token={token}
                  />
                );
            })
        )}
      </div>
    </div>
  );
}
