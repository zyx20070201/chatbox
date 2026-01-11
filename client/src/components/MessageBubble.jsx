// src/components/MessageBubble.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Smile, Reply, Trash2, Edit2, CheckCheck, Pin, Star, FileText, Download, Copy, X, Save } from 'lucide-react';
import { formatMessageTime, formatFullTime, escapeHtml } from '../utils';
import RichInput from './RichInput';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function MessageBubble({ message, isMe, currentUser, socket, onReply, showAvatar, onOpenThread, activeThreadId, onShowToast, onRemove, token }) {
  const [showMenu, setShowMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const bubbleRef = useRef(null);
  const [isBookmarked, setIsBookmarked] = useState(message.bookmarks?.length > 0);
  
  // Editing State
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content || "");
  const [showHistory, setShowHistory] = useState(false);
  
  // Mention Logic
  const myMention = message.mentions?.find(m => Number(m.userId) === Number(currentUser.id));
  const isMentioned = !!myMention;
  const isMentionRead = myMention?.isRead;

  let linkMetadata = null;
  try {
    linkMetadata = message.linkMetadata ? JSON.parse(message.linkMetadata) : null;
  } catch (e) {
    console.warn("Invalid linkMetadata:", message.linkMetadata);
  }

  // --- 核心逻辑：将原始 reactions 数组聚合成 UI 友好的分组格式 ---
  // 结果示例: { "👍": { count: 2, isMine: true, users: ["Alice", "Bob"] }, ... }
  const reactionGroups = (message.reactions || []).reduce((acc, r) => {
    if (!acc[r.emoji]) {
      acc[r.emoji] = { count: 0, isMine: false, users: [] };
    }
    acc[r.emoji].count += 1;
    if (r.user?.username) {
        acc[r.emoji].users.push(r.user.username);
    }
    
    // 判断我是否点过
    if (currentUser && Number(r.userId) === Number(currentUser.id)) {
      acc[r.emoji].isMine = true;
    }
    return acc;
  }, {});

  // --- 已读回执逻辑 ---
  useEffect(() => {
    if (!isMe && socket && bubbleRef.current) {
        // 如果已经读过，就不再监听
        const hasRead = message.readBy?.some(r => Number(r.userId) === Number(currentUser.id));
        if (hasRead) return;

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                socket.emit('mark_read', { messageId: message.id });
                observer.disconnect();
            }
        }, { threshold: 0.5 });

        observer.observe(bubbleRef.current);
        return () => observer.disconnect();
    }
  }, [message.id, isMe, socket, message.readBy, currentUser.id]);

  // --- 事件处理 ---
  const handleAckMention = () => {
      if (myMention) {
          socket.emit('mark_mention_read', { mentionId: myMention.id });
      }
  };

  const handleDelete = () => {
      socket.emit('delete_message', { messageId: message.id });
      if (onShowToast) {
          onShowToast("Message deleted", () => socket.emit('restore_message', { messageId: message.id }));
      }
  };
  
  // 发送切换表情请求 (Toggle)
  const handleReact = (emoji) => { 
      socket.emit('toggle_reaction', { messageId: message.id, emoji }); 
      setShowMenu(false); 
  };

  const handlePasteEmoji = async () => {
      try {
          const text = await navigator.clipboard.readText();
          // Regex to check if text contains emoji (simplified)
          if (/\p{Emoji}/u.test(text)) {
              handleReact(text.trim());
          }
      } catch (err) {
          console.error('Failed to read clipboard:', err);
      }
  };
  
  const handlePin = () => {
      // Toggle logic
      const newPinnedState = !message.isPinned;
      
      // If we are Unpinning (new state is false), offer Undo (which sets it back to true)
      if (!newPinnedState && onShowToast) {
          onShowToast("Message unpinned", () => {
              socket.emit('pin_message', { messageId: message.id, isPinned: true });
          });
      }
      
      socket.emit('pin_message', { messageId: message.id, isPinned: newPinnedState });
  };

  const handleBookmark = async (e) => {
      if (e) {
          e.preventDefault();
          e.stopPropagation();
      }
      try {
          const res = await fetch(`${SOCKET_URL}/api/bookmarks`, {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token || localStorage.getItem('token')}`
              },
              body: JSON.stringify({ messageId: message.id })
          });
          
          if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              console.error("Bookmark failed:", res.status, errData);
              return;
          }

          const data = await res.json();
          setIsBookmarked(data.bookmarked);
          
          if (!data.bookmarked && onShowToast) {
              // 取消收藏时显示 Undo
              onShowToast("Removed from bookmarks", () => handleBookmark());
          }
      } catch (e) { console.error("Bookmark error:", e); }
  };

  const handleCopy = () => {
      const text = new DOMParser().parseFromString(message.content || "", 'text/html').body.innerText;
      navigator.clipboard.writeText(text);
  };

  const handleEditSave = () => {
      if (!editContent || editContent === message.content) {
          setIsEditing(false);
          return;
      }
      socket.emit('edit_message', { messageId: message.id, newContent: editContent });
      setIsEditing(false);
  };

  // 如果消息被删除，显示占位符
  if (message.isDeleted) {
      return (
        <div className={`flex w-full gap-2 mb-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`px-4 py-2 rounded-2xl text-sm bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-gray-500 italic flex items-center gap-2 transition-colors`}>
                 <Trash2 size={14} />
                 <span>This message was deleted</span>
                 {onRemove && (
                     <button onClick={onRemove} className="ml-2 hover:text-red-500 transition" title="Remove notification">
                         <X size={14} />
                     </button>
                 )}
            </div>
        </div>
      );
  }

  return (
    <div 
      id={`message-${message.id}`}
      ref={bubbleRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setShowMenu(false); }}
      className={`flex group w-full gap-2 mb-2 transition-all duration-200 ${
        isMe ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      
      <div className={`flex flex-col max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
        
        <div className={`flex items-center gap-2 mb-1 px-1 ${isMe ? 'flex-row-reverse' : ''}`}>
            <span className="font-bold text-gray-700 dark:text-gray-300 text-sm transition-colors">{message.user?.username || 'Unknown User'}</span>
            <span className="text-xs text-gray-500 cursor-help" title={formatFullTime(message.createdAt)}>
                {formatMessageTime(message.createdAt)}
            </span>
            {message.isPinned && <span className="text-xs text-blue-500 dark:text-blue-400 font-semibold flex items-center">📌 Pinned</span>}
        </div>

        {message.parent && (
            <div 
                onClick={(e) => {
                    e.stopPropagation();
                    if (onOpenThread) onOpenThread(message.parentId);
                }}
                className={`mb-1 text-xs text-gray-500 dark:text-gray-400 border-l-2 border-gray-300 dark:border-gray-600 pl-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded p-1 opacity-80 transition-colors`}
                title="Click to view full thread"
            >
                Reply to <b>{message.parent.user?.username || 'Unknown User'}</b>: {
                    message.parent.isDeleted 
                        ? <span className="italic">The message was deleted</span>
                        : (message.parent.content?.substring(0, 30) + (message.parent.content?.length > 30 ? "..." : ""))
                }
                <span className={`ml-2 text-[10px] transition-all duration-200 ${
                    activeThreadId === message.parentId ? 'text-red-500 dark:text-red-400 font-semibold opacity-100' : 'text-blue-500 dark:text-blue-400 opacity-0 group-hover:opacity-100'
                }`}>
                    {activeThreadId === message.parentId ? "Close Thread ←" : "View Thread →"}
                </span>
            </div>
        )}

        <div className={`relative px-4 py-2 rounded-2xl text-sm shadow-md transition-all
            ${isMe 
              ? 'bg-blue-600 text-white rounded-tr-none' 
              : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-none border border-gray-200 dark:border-transparent' 
            }
            ${isMentioned && !isMentionRead ? 'animate-[pulse_1s_ease-in-out_3]' : ''} 
        `}>
          {/* Sender View: Mention Status */}
          {isMe && message.mentions && message.mentions.length > 0 && (
              <div className="text-[10px] opacity-75 mb-1 pb-1 border-b border-white/20">
                  {message.mentions.map(m => (
                      <span key={m.id} className="mr-2 inline-flex items-center gap-0.5">
                          @{m.user?.username || 'User'} 
                          {m.isRead ? <CheckCheck size={10} /> : <span className="w-2 h-2 bg-yellow-400 rounded-full inline-block ml-0.5" title="Unread"></span>}
                      </span>
                  ))}
              </div>
          )}

          {/* Receiver View: Acknowledge Button */}
          {isMentioned && !isMentionRead && !isMe && (
              <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                      You were mentioned
                  </span>
                  <button 
                    onClick={handleAckMention}
                    className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-1 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition font-medium"
                  >
                      Sign In
                  </button>
              </div>
          )}

          {/* 附件渲染 */}
          {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-col gap-2 mb-2">
                  {message.attachments.map(att => {
                      if (att.mimeType.startsWith('image/')) {
                          return (
                              <div key={att.id} className="relative group/img max-w-sm">
                                  <img 
                                    src={`${SOCKET_URL}${att.url}`} 
                                    alt="attachment" 
                                    className="rounded-lg object-cover bg-black/20 cursor-pointer hover:opacity-90 transition"
                                    loading="lazy"
                                    onClick={() => window.open(`${SOCKET_URL}${att.originalUrl || att.url}`, '_blank')}
                                  />
                                  <a 
                                    href={`${SOCKET_URL}${att.originalUrl || att.url}`} 
                                    download={att.filename}
                                    className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white p-1.5 rounded-full opacity-0 group-hover/img:opacity-100 transition"
                                    title="Download Original"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                      <Download size={14} />
                                  </a>
                              </div>
                          );
                      } else {
                          return (
                              <div key={att.id} className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 p-3 rounded-lg max-w-sm group/file hover:bg-gray-800 transition">
                                  <div className="p-2 bg-gray-700 rounded text-blue-400">
                                      <FileText size={20} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <div className="truncate text-sm font-medium text-gray-200" title={att.filename}>{att.filename}</div>
                                      <div className="text-xs text-gray-500">{(att.size / 1024).toFixed(1)} KB</div>
                                  </div>
                                  <a 
                                    href={`${SOCKET_URL}${att.url}`} 
                                    download={att.filename}
                                    className="p-2 hover:bg-gray-600 rounded-full text-gray-400 hover:text-white transition"
                                    title="Download"
                                  >
                                      <Download size={16} />
                                  </a>
                              </div>
                          );
                      }
                  })}
              </div>
          )}
          
          {/* 文本内容渲染 (HTML / Rich Text) 或 编辑模式 */}
          {isEditing ? (
              <div className="min-w-[200px] bg-gray-100 dark:bg-gray-900 rounded p-2 border border-blue-500/50 transition-colors">
                  <div className="text-gray-900 dark:text-white">
                    <RichInput 
                        value={editContent} 
                        onChange={setEditContent} 
                        onEnter={handleEditSave}
                        placeholder="Edit message..."
                    />
                  </div>
                  <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setIsEditing(false)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1"><X size={12}/> Cancel</button>
                      <button onClick={handleEditSave} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded flex items-center gap-1"><Save size={12}/> Save</button>
                  </div>
              </div>
          ) : (
              message.content && (
                <div 
                    className={`prose prose-sm max-w-none break-words 
                        ${isMe ? 'prose-invert' : 'prose-gray dark:prose-invert'}
                        prose-p:my-1 prose-headings:my-2 prose-pre:my-2 
                        prose-pre:bg-gray-800 dark:prose-pre:bg-black/30
                        prose-pre:text-gray-100
                    `}
                    dangerouslySetInnerHTML={{ __html: message.content }}
                />
              )
          )}

          {/* 链接预览卡片 */}
          {linkMetadata && (
            <div 
                className="mt-2 bg-black/20 rounded-lg overflow-hidden border border-white/10 max-w-sm hover:bg-black/30 transition cursor-pointer" 
                onClick={() => {
                    const url = message.content.match(/http[s]?:\/\/[^ ]+/)?.[0];
                    if (url) window.open(url, '_blank');
                }}
            >
                {linkMetadata.image && <img src={linkMetadata.image} alt="preview" className="w-full h-32 object-cover" />}
                <div className="p-2">
                    <div className="font-bold truncate">{linkMetadata.title}</div>
                    <div className="text-xs text-gray-400 line-clamp-2">{linkMetadata.description}</div>
                </div>
            </div>
          )}

          {/* 编辑标记 & 历史记录 */}
          {message.editHistory?.length > 0 && !isEditing && (
              <div className="relative">
                  <span 
                    onClick={() => setShowHistory(!showHistory)}
                    className="text-[10px] opacity-60 ml-1 block text-right mt-1 cursor-pointer hover:underline hover:text-blue-300"
                  >
                      (edited)
                  </span>
                  {showHistory && (
                      <div className="absolute top-full right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 p-2 text-xs">
                          <div className="font-bold border-b border-gray-700 pb-1 mb-1 text-gray-400">Edit History</div>
                          <div className="max-h-40 overflow-y-auto space-y-2">
                              {message.editHistory.map(h => (
                                  <div key={h.id} className="bg-gray-900/50 p-1.5 rounded">
                                      <div className="text-gray-500 mb-0.5">{new Date(h.editedAt).toLocaleString()}</div>
                                      <div className="text-gray-300 line-clamp-2" dangerouslySetInnerHTML={{__html: h.oldContent}}></div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}
              </div>
          )}
        </div>
        
        {/* --- 底部状态区 (表情胶囊 + 已读) --- */}
        <div className={`flex flex-wrap items-center gap-2 mt-1 px-1 min-h-[24px] ${isMe ? 'justify-end' : 'justify-start'}`}>
            
            {/* 1. 渲染聚合后的表情按钮组 */}
            {Object.entries(reactionGroups).map(([emoji, data]) => (
                <button
                    key={emoji}
                    onClick={() => handleReact(emoji)} // 点击已有的表情也能切换状态
                    title="Click to toggle"
                    className={`
                        group/reaction relative flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-all duration-200 shadow-sm
                        ${data.isMine 
                            ? 'bg-blue-50 border-blue-200 text-blue-600' // 我点过的: 浅蓝高亮
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' // 没点过的: 白色
                        }
                    `}
                >
                    <span className="text-sm leading-none">{emoji}</span>
                    <span className={`font-semibold ${data.isMine ? 'text-blue-700' : 'text-gray-700'}`}>{data.count}</span>
                    
                    {/* 悬浮显示名单 (Tooltip) */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/reaction:block z-30 opacity-0 group-hover/reaction:opacity-100 transition-opacity">
                        <div className="bg-white text-gray-800 text-[10px] py-1.5 px-2.5 rounded-lg whitespace-nowrap border border-gray-200 shadow-xl">
                            <div className="font-bold mb-1 border-b border-gray-100 pb-1 text-gray-500 uppercase tracking-wider">Reacted by</div>
                            <div className="flex flex-col gap-0.5">
                                {data.users.slice(0, 5).map((u, i) => <div key={i}>{u}</div>)}
                                {data.users.length > 5 && <div className="text-gray-400 italic">and {data.users.length - 5} more...</div>}
                            </div>
                        </div>
                        {/* Tooltip 小三角 */}
                        <div className="w-2.5 h-2.5 bg-white rotate-45 absolute -bottom-1.25 left-1/2 -translate-x-1/2 border-r border-b border-gray-200"></div>
                    </div>
                </button>
            ))}
            
            {/* 2. 已读回执 (仅自己可见) */}
            {isMe && message.readBy?.length > 0 && (
                <div className="flex items-center text-xs text-blue-400 group/read relative ml-1 cursor-help">
                    <CheckCheck size={14} className="mr-1" />
                    <span>{message.readBy.length}</span>
                    {/* 已读人员名单 Tooltip */}
                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover/read:block bg-black/90 text-white text-xs p-2 rounded w-max z-20 shadow-lg border border-gray-700 backdrop-blur-sm">
                        <div className="font-semibold mb-0.5 border-b border-gray-700 pb-0.5 text-gray-400">Read by:</div>
                        {message.readBy.map(r => r.user?.username || 'Unknown').join(', ')}
                    </div>
                </div>
            )}
        </div>

        {/* --- 操作栏 (移动到消息下方) --- */}
        <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
            {/* 表情菜单按钮 */}
            <div className="relative">
                <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 rounded-full hover:bg-gray-700 text-gray-400 transition" title="Add Reaction">
                    <Smile size={16} />
                </button>
                {showMenu && (
                    <div className={`absolute bottom-full mb-2 bg-white border border-gray-200 rounded-2xl flex flex-col p-2 shadow-2xl z-20 animate-in zoom-in-50 slide-in-from-bottom-2 ${isMe ? 'right-0' : 'left-0'}`}>
                        <div className="flex p-1 bg-gray-50 rounded-xl mb-1">
                            {['❤️', '👍', '😂', '😮', '😡', '🚀', '👀'].map(emoji => (
                                <button 
                                    key={emoji} 
                                    onClick={() => handleReact(emoji)} 
                                    className={`p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-xl ${reactionGroups[emoji]?.isMine ? 'bg-white shadow-sm ring-1 ring-blue-100' : ''}`}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <button 
                            onClick={handlePasteEmoji}
                            className="w-full py-1.5 px-3 text-[10px] font-bold text-gray-400 hover:text-blue-500 uppercase tracking-widest text-center transition-colors"
                        >
                            Paste Any Emoji From Clipboard
                        </button>
                    </div>
                )}
            </div>

            {/* 回复 */}
            <button onClick={() => onReply(message)} className="p-1.5 rounded-full hover:bg-gray-700 text-gray-400 transition" title="Reply">
                <Reply size={16} />
            </button>

            {/* 复制 */}
            <button onClick={handleCopy} className="p-1.5 rounded-full hover:bg-gray-700 text-gray-400 transition" title="Copy">
                <Copy size={16} />
            </button>

            {/* 收藏 */}
            <button onClick={handleBookmark} className={`p-1.5 rounded-full hover:bg-gray-700 transition ${isBookmarked ? 'text-yellow-400' : 'text-gray-400'}`} title={isBookmarked ? "Remove Bookmark" : "Bookmark"}>
                <Star size={16} className={isBookmarked ? "fill-current" : ""} />
            </button>

            {/* 置顶 */}
            <button onClick={handlePin} className={`p-1.5 rounded-full hover:bg-gray-700 transition ${message.isPinned ? 'text-blue-400' : 'text-gray-400'}`} title={message.isPinned ? "Unpin" : "Pin"}>
                <Pin size={16} />
            </button>

            {/* 仅自己可见的操作 (编辑 / 删除) */}
            {isMe && (
                <>
                    <button 
                        onClick={() => setIsEditing(true)} 
                        className={`p-1.5 rounded-full hover:bg-gray-700 text-gray-400 transition ${Date.now() - new Date(message.createdAt).getTime() > 5 * 60 * 1000 ? 'hidden' : ''}`} // 5分钟后隐藏
                        title="Edit"
                    >
                        <Edit2 size={16} />
                    </button>
                    <button onClick={handleDelete} className="p-1.5 rounded-full hover:bg-red-500/20 text-red-400 transition" title="Delete">
                        <Trash2 size={16} />
                    </button>
                </>
            )}
        </div>
      </div>
    </div>
  );
}
