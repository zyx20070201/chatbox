// src/components/ChatRoom.jsx
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import MessageBubble from './MessageBubble';
import MentionList from './MentionList'; // 引入 MentionList
import { Send, LogOut, Paperclip, Pin, Star, Search, ArrowDownCircle, FileText, Bold, Italic, Code, List, Link as LinkIcon, AtSign, X } from 'lucide-react';
import ThreadPanel from './ThreadPanel'; // 引入新组件
import BookmarksPanel from './BookmarksPanel';
import MentionsPanel from './MentionsPanel'; // 引入 MentionsPanel
import SearchPanel from './SearchPanel';
import FileVaultPanel from './FileVaultPanel';
import DateDivider from './DateDivider';
import RichInput from './RichInput';
import { checkIsSameDay, checkIsTimeGap, escapeHtml } from '../utils';
import { Folder } from 'lucide-react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// 简单的提示音效 (Base64 encoded beep)
const MENTION_SOUND = "data:audio/wav;base64,UklGRl9vT1BXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"; // Placeholder, simplified

export default function ChatRoom({ token, currentUser, onLogout }) {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showFileVault, setShowFileVault] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [unreadMentionCount, setUnreadMentionCount] = useState(0);
  const [isArchiveView, setIsArchiveView] = useState(false);
  const [showRichText, setShowRichText] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState(null); // { message, onUndo }

  // Mention State
  const [mentionSearch, setMentionSearch] = useState(null);
  const [mentionMap, setMentionMap] = useState(new Map()); // ID -> Username
  
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null); // 【关键】用于控制滚动的容器 Ref
  const fileInputRef = useRef(null);
  const textInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // 智能滚动逻辑
  const smartScrollToBottom = (force = false) => {
    // 【修复】确保 scrollIntoView 有效
    if (messagesEndRef.current) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
            try {
                messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            } catch (e) {
                messagesEndRef.current.scrollIntoView(); // Fallback
            }
        });
    }
  };

  useEffect(() => {
    if (!token) return;
    
    const newSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
      forceNew: false, // Ensure only one connection
    });
    setSocket(newSocket);

    // 获取历史消息 & 未读提及
    const loadData = () => {
        fetch(`${SOCKET_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } })
          .then(res => res.json())
          .then(data => {
            setMessages(data);
            const pinned = data.find(m => m.isPinned);
            if (pinned) setPinnedMessage(pinned);
            setIsArchiveView(false);
            setTimeout(() => smartScrollToBottom(true), 100);
          });
          
        fetch(`${SOCKET_URL}/api/mentions?unreadOnly=true`, { headers: { Authorization: `Bearer ${token}` } })
          .then(res => res.json())
          .then(data => {
              if (Array.isArray(data)) {
                  setUnreadMentionCount(data.length);
              }
          }).catch(err => console.error("Mention load failed:", err));
    };
    loadData();

    newSocket.on('new_message', (msg) => {
      // 如果在查看历史记录，不自动追加新消息，只播放提示音
      if (isArchiveView) return;

      const isMe = Number(msg.user.id) === Number(currentUser.id);
      
      setMessages(prev => [...prev, msg]);
      
      // 提及强提醒 (声音播放 & 计数)
      if (msg.mentions?.some(m => Number(m.userId) === Number(currentUser.id))) {
          setUnreadMentionCount(prev => prev + 1);
          try {
              // 尝试播放提示音 (浏览器可能限制自动播放，需要交互后才能播放)
              const audio = new Audio(MENTION_SOUND); 
              audio.play().catch(e => {});
          } catch(e) {}
      }

      // 智能滚动逻辑：如果是自己发的，强制滚动；
      // 如果是别人发的，检查当前是否在底部附近
      if (isMe) {
          smartScrollToBottom(true);
      } else {
          const container = scrollContainerRef.current;
          if (container) {
              const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
              if (isNearBottom) {
                  smartScrollToBottom(true);
              } else {
                  setHasNewMessages(true);
              }
          }
      }
    });

    newSocket.on('message_deleted', ({ messageId }) => {
      setHasNewMessages(false); // 消息被删除时，清除新消息提示
      setMessages(prev => {
          const targetMsg = prev.find(m => m.id === messageId);
          // If the deleted message mentioned me and was unread, decrement count
          const myMention = targetMsg?.mentions?.find(men => Number(men.userId) === Number(currentUser.id));
          if (myMention && !myMention.isRead) {
              setUnreadMentionCount(count => Math.max(0, count - 1));
          }

          // 1. Remove the deleted message itself
          const filtered = prev.filter(m => m.id !== messageId);
          // 2. Update any message that replies to it (Quote Sync)
          return filtered.map(m => {
              if (m.parent && Number(m.parent.id) === Number(messageId)) {
                  return { ...m, parent: { ...m.parent, isDeleted: true } };
              }
              return m;
          });
      });
    });

    newSocket.on('message_updated', (updatedMsg) => {
      // If message was edited and I am mentioned, reset red dot?
      const myMention = updatedMsg.mentions?.find(men => Number(men.userId) === Number(currentUser.id));
      if (myMention && !myMention.isRead) {
          // Check if we already knew about this mention as unread
          // This is a bit complex, but let's at least ensure we don't undercount.
          // For simplicity, we fetch count again? No, socket is better.
          // We'll just increment and let loadData sync it if needed.
          setUnreadMentionCount(prev => prev + 1);
      }

      setMessages(prev => prev.map(m => {
          // 1. 如果是消息本身被修改
          if (m.id === updatedMsg.id) return updatedMsg;
          // 2. 如果消息引用了被修改的消息 (Reply Context Sync)
          if (m.parent && m.parent.id === updatedMsg.id) {
              return { ...m, parent: updatedMsg };
          }
          return m;
      }));
      // 同步更新置顶消息的内容
      setPinnedMessage(prev => prev?.id === updatedMsg.id ? updatedMsg : prev);
    });

    newSocket.on('message_restored', (restoredMsg) => {
        if (!restoredMsg || !restoredMsg.id) return;

        // 如果不是我恢复的，且当前不在底部，显示新消息提示
        const isMe = Number(restoredMsg.user?.id) === Number(currentUser.id);
        if (!isMe) {
            const container = scrollContainerRef.current;
            if (container) {
                const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
                if (!isNearBottom) {
                    setHasNewMessages(true);
                }
            }
        }

        // Restore mention red dot if applicable
        const myMention = restoredMsg.mentions?.find(men => Number(men.userId) === Number(currentUser.id));
        if (myMention && !myMention.isRead) {
            setUnreadMentionCount(count => count + 1);
        }

        setMessages(prev => {
            let newMsgs = [...prev];
            const existingIndex = prev.findIndex(m => m.id === restoredMsg.id);

            // 1. Add back or Update the restored message
            if (existingIndex === -1) {
                newMsgs.push(restoredMsg);
                // Robust sort
                newMsgs.sort((a, b) => {
                    const t1 = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const t2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return t1 - t2;
                });
            } else {
                newMsgs[existingIndex] = restoredMsg;
            }
            
            // 2. Update any message that replies to it (Restore Quote)
            return newMsgs.map(m => {
                 if (m && m.parent && Number(m.parent.id) === Number(restoredMsg.id)) {
                     return { ...m, parent: restoredMsg };
                 }
                 return m;
            });
        });
    });

    newSocket.on('bookmark_updated', ({ message, bookmarked }) => {
        if (!message) return;
        setMessages(prev => prev.map(m => {
            if (m.id === message.id) {
                if (bookmarked) {
                    return { ...m, bookmarks: message.bookmarks || [] };
                } else {
                    return { ...m, bookmarks: [] };
                }
            }
            return m;
        }));
    });


    // 1. 监听新增表情
    newSocket.on('message_reaction_added', ({ messageId, reaction }) => {
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId) {
          return { ...msg, reactions: [...(msg.reactions || []), reaction] };
        }
        return msg;
      }));
    });

    // 2. 监听取消表情
    newSocket.on('message_reaction_removed', ({ messageId, emoji, userId }) => {
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            // 过滤掉匹配 userId 和 emoji 的那个表情
            reactions: msg.reactions.filter(r => !(r.userId === userId && r.emoji === emoji))
          };
        }
        return msg;
      }));
    });

    newSocket.on('force_logout', ({ reason }) => {
        console.warn('Force logout received:', reason);
        alert(`You have been logged out remotely. Reason: ${reason}`);
        onLogout();
    });


    newSocket.on('my_mention_updated', (updatedMention) => {
        if (updatedMention.isRead) {
            setUnreadMentionCount(prev => Math.max(0, prev - 1));
        }
        
        // Update local message list to reflect read status
        setMessages(prev => prev.map(m => {
            if (m.id === updatedMention.messageId && m.mentions) {
                return {
                    ...m,
                    mentions: m.mentions.map(men => men.id === updatedMention.id ? updatedMention : men)
                };
            }
            return m;
        }));
    });
    
    newSocket.on('mention_read_status', ({ messageId, readByUserId }) => {
        // I am the Sender, update my message's mention status
        setMessages(prev => prev.map(m => {
            if (m.id === messageId && m.mentions) {
                return {
                    ...m,
                    mentions: m.mentions.map(men => Number(men.userId) === Number(readByUserId) ? { ...men, isRead: true } : men)
                };
            }
            return m;
        }));
    });

    newSocket.on('user_typing', ({ username }) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.add(username);
        return newSet;
      });
      setTimeout(() => {
        setTypingUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(username);
          return newSet;
        });
      }, 3000);
    });

    // 批量已读更新 [13]
    newSocket.on('message_read_update_batch', ({ messageId, userIds }) => {
       setMessages(prev => prev.map(m => {
           if (m.id === messageId) {
               const existingIds = m.readBy?.map(r => r.userId) || [];
               const newReads = userIds.filter(uid => !existingIds.includes(uid)).map(uid => ({ userId: uid }));
               return { ...m, readBy: [...(m.readBy || []), ...newReads] };
           }
           return m;
       }));
    });
    
    newSocket.on('message_pinned', ({ messageId, isPinned }) => {
        setMessages(prev => {
            // 如果是新增置顶，先清除所有其他的置顶状态 (互斥)
            let newMsgs = [...prev];
            if (isPinned) {
                newMsgs = newMsgs.map(m => ({ ...m, isPinned: false }));
            }
            
            // 更新目标消息
            newMsgs = newMsgs.map(m => m.id === messageId ? { ...m, isPinned } : m);
            
            if (isPinned) {
                const target = newMsgs.find(m => m.id === messageId);
                setPinnedMessage(target);
            } else {
                // 如果是取消置顶，且当前置顶的是该消息，则清空 Banner
                setPinnedMessage(prevPin => prevPin?.id === messageId ? null : prevPin);
            }
            return newMsgs;
        });
    });

    return () => {
        console.log('ChatRoom socket effect cleaning up. Disconnecting socket:', newSocket?.id);
        if (newSocket) newSocket.disconnect();
    };
  }, [token]);

  const handleSendMessage = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    
    let contentToSend = inputText;
    let isEmpty = false;
    let textForCheck = inputText; // Used for checking mentions

    if (showRichText) {
        const cleanText = inputText.replace(/<[^>]*>/g, '').trim();
        isEmpty = !cleanText;
        // For rich text, contentToSend IS the HTML.
        // But for mention checking, we might want to check the text content or HTML content.
        // @username is inserted as <strong>@username</strong> usually.
        // We'll check if the username exists in the content.
    } else {
        contentToSend = escapeHtml(inputText.trim());
        isEmpty = !inputText.trim();
    }

    if ((isEmpty && !replyTo) || !socket) return;

    // Filter valid mentions: User must be in the map AND their username must be present in the text
    const validMentionIds = Array.from(mentionMap.entries())
        .filter(([id, username]) => contentToSend.includes(`@${username}`))
        .map(([id]) => id);

    socket.emit('send_message', {
      content: contentToSend,
      type: 'text',
      replyToId: replyTo?.id,
      mentionUserIds: validMentionIds
    });
    setInputText('');
    setMentionMap(new Map());
    setReplyTo(null);
    socket.emit('stop_typing');
  };

  const handleTyping = (val) => {
    setInputText(val);

    let text = val;
    if (showRichText) {
        const div = document.createElement('div');
        div.innerHTML = val;
        text = div.innerText;
    }
    
    const lastWord = text.split(/\s+/).pop();
    if (lastWord && lastWord.startsWith('@')) {
        setMentionSearch(lastWord.slice(1));
    } else {
        setMentionSearch(null);
    }

    if (socket) {
      socket.emit('typing_start');
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => socket.emit('stop_typing'), 2000);
    }
  };

  const toggleRichText = () => {
      if (showRichText) {
          // Rich -> Plain: Extract Text
          const div = document.createElement('div');
          div.innerHTML = inputText;
          setInputText(div.innerText);
      } else {
          // Plain -> Rich: Escape HTML
          setInputText(escapeHtml(inputText));
      }
      setShowRichText(!showRichText);
  };

  const handleSelectMention = (user) => {
      if (showRichText) {
          if (textInputRef.current) {
              textInputRef.current.execCommand('insertHTML', `&nbsp;<strong>@${user.username}</strong>&nbsp;`);
          }
      } else {
          // Plain Text Mode: Replace the @query at the end of input
          const newVal = inputText.replace(/@\S*$/, `@${user.username} `);
          setInputText(newVal);
      }
      setMentionMap(prev => new Map(prev).set(user.id, user.username));
      setMentionSearch(null);
  };

  const handleJumpToMessage = async (messageId) => {
      // Auto-close panels on jump to avoid visual clutter
      closeAllPanels();

      let el = document.getElementById(`message-${messageId}`);
      
      if (!el) {
          // 尝试加载上下文
          try {
              const res = await fetch(`${SOCKET_URL}/api/messages/${messageId}/context`, {
                  headers: { Authorization: `Bearer ${token}` }
              });
              if (!res.ok) throw new Error("Failed");
              const contextMessages = await res.json();
              
              setMessages(contextMessages);
              setIsArchiveView(true);
              
              setTimeout(() => {
                  el = document.getElementById(`message-${messageId}`);
                  if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-gray-900');
                      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-gray-900'), 2000);
                  }
              }, 100);
          } catch (e) {
              alert("Message could not be found or loaded.");
          }
      } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-gray-900');
          setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-gray-900'), 2000);
      }
  };

  const handleReturnToLive = () => {
      fetch(`${SOCKET_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          setMessages(data);
          setIsArchiveView(false);
          setTimeout(() => smartScrollToBottom(true), 100);
        });
  };

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch(`${SOCKET_URL}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        socket.emit('send_message', {
            content: "", 
            type: data.mimeType.startsWith('image/') ? 'image' : 'file',
            attachments: [data]
        });
    } catch (e) {
        console.error("Upload failed", e);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) uploadFile(file);
  };

  const handleDrop = (e) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      files.forEach(file => uploadFile(file));
  };

  const formatText = (command) => {
      if (textInputRef.current) {
          textInputRef.current.execCommand(command);
          textInputRef.current.focus();
      }
  };

  const handleShowToast = (message, onUndo) => {
      setToast({ message, onUndo });
      // Clear existing timeout if any
      if (window.toastTimeout) clearTimeout(window.toastTimeout);
      window.toastTimeout = setTimeout(() => setToast(null), 5000);
  };

  const closeAllPanels = () => {
    setShowSearch(false);
    setShowMentions(false);
    setShowFileVault(false);
    setShowBookmarks(false);
    setActiveThreadId(null);
  };

  return (
    // 【布局升级】: 最外层容器改为默认 Flex (Row)，以便横向排列主聊天区和 Thread 侧边栏
    // 使用 h-screen 锁定整个视口高度
    <div className="flex h-screen overflow-hidden bg-white text-gray-900 font-sans" onClick={() => setShowMenu(false)}>

      {/* --- 主聊天区域 (Main Chat Area) --- */}
      {/* 添加 flex-1 占据剩余宽度, flex-col 垂直排列 Header/List/Input, min-w-0 防止 flex 子项溢出 */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-gray-200 relative transition-all duration-300">
        
        {/* Header */}
        <header className="flex-none bg-gray-50 p-4 shadow-md flex justify-between items-center z-10 border-b border-gray-200 relative">
          <div className="flex items-center gap-3">
          </div>

          <div className="absolute left-1/2 -translate-x-1/2">
            <h2 className="text-xl font-bold tracking-tight text-gray-800">ChatBox</h2>
          </div>
          
          {/* Dropdown Menu Container */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button 
                onClick={() => setShowMenu(!showMenu)}
                className={`p-2 rounded-full transition relative ${showMenu ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 text-gray-600'}`}
                title="Menu"
              >
                <List size={20} />
                {unreadMentionCount > 0 && (
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-gray-900"></span>
                )}
              </button>

              {showMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-xl py-2 z-50 animate-in fade-in zoom-in-95">
                      <button 
                        onClick={() => { closeAllPanels(); setShowSearch(true); setShowMenu(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${showSearch ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        <Search size={18} /> Search
                      </button>
                      <button 
                        onClick={() => { closeAllPanels(); setShowMentions(true); setShowMenu(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition relative ${showMentions ? 'bg-purple-50 text-purple-600' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        <AtSign size={18} /> Mentions
                        {unreadMentionCount > 0 && (
                            <span className="absolute right-4 w-2 h-2 bg-red-500 rounded-full"></span>
                        )}
                      </button>
                      <button 
                        onClick={() => { closeAllPanels(); setShowFileVault(true); setShowMenu(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${showFileVault ? 'bg-green-50 text-green-600' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        <Folder size={18} /> File Vault
                      </button>
                      <button 
                        onClick={() => { closeAllPanels(); setShowBookmarks(true); setShowMenu(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${showBookmarks ? 'bg-yellow-50 text-yellow-600' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        <Star size={18} className={showBookmarks ? "fill-current" : ""} /> Bookmarks
                      </button>
                      <div className="my-1 border-t border-gray-100"></div>
                      <button 
                        onClick={() => { setShowMenu(false); onLogout(); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
                      >
                        <LogOut size={18} /> Logout
                      </button>
                  </div>
              )}
          </div>
        </header>

        {/* Archive View Banner */}
        {isArchiveView && (
            <div className="flex-none bg-indigo-900/90 text-indigo-100 px-4 py-2 flex justify-between items-center z-20 shadow-md">
                <span className="text-sm">Viewing message archive (Live updates paused)</span>
                <button 
                    onClick={handleReturnToLive}
                    className="flex items-center gap-1 text-xs bg-indigo-700 hover:bg-indigo-600 px-3 py-1 rounded transition"
                >
                    <ArrowDownCircle size={14} /> Return to Live
                </button>
            </div>
        )}

        {/* Pinned Message */}
        {pinnedMessage && (
            <div 
                onClick={() => handleJumpToMessage(pinnedMessage.id)}
                className="flex-none bg-blue-50/90 backdrop-blur border-b border-blue-100 px-4 py-2.5 flex items-center gap-3 text-sm text-blue-700 shadow-sm z-10 cursor-pointer hover:bg-blue-100/80 transition-all group/pin"
            >
                <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg group-hover/pin:scale-110 transition-transform">
                    <Pin size={14} className="fill-current" />
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider leading-none mb-0.5">Pinned Message</span>
                    <span className="truncate max-w-md text-blue-800 font-medium">{pinnedMessage.content || "Attached File"}</span>
                </div>
                <div className="ml-auto text-blue-400 opacity-0 group-hover/pin:opacity-100 transition-opacity text-xs font-semibold">
                    Click to jump →
                </div>
            </div>
        )}

        {/* Message List Area (Drag Drop Target) */}
        <div 
          ref={scrollContainerRef}
          onScroll={() => {
              const container = scrollContainerRef.current;
              if (container && container.scrollHeight - container.scrollTop - container.clientHeight < 50) {
                  setHasNewMessages(false);
              }
          }}
          className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent relative ${isDragging ? 'bg-gray-800/50' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {isDragging && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-50 border-2 border-dashed border-blue-500 m-4 rounded-xl pointer-events-none">
                  <div className="text-blue-400 font-bold text-xl flex flex-col items-center gap-2">
                      <Folder size={48} />
                      Drop files to upload
                  </div>
              </div>
          )}
          {messages.map((msg, idx) => {
            if (!msg || !msg.user) return null; // 安全检查

            const prevMsg = messages[idx - 1];
            const showDivider = idx === 0 || !prevMsg || !checkIsSameDay(msg.createdAt, prevMsg.createdAt);
            
            // 安全访问 prevMsg 属性
            const isDifferentUser = !prevMsg || prevMsg.user?.id !== msg.user.id;
            const isTimeGap = !prevMsg || checkIsTimeGap(msg.createdAt, prevMsg.createdAt);
            
            const showAvatar = idx === 0 || isDifferentUser || showDivider || isTimeGap;

            return (
              <React.Fragment key={msg.id}>
                {showDivider && <DateDivider date={msg.createdAt} />}
                <MessageBubble 
                  message={msg} 
                  isMe={Number(msg.user.id) === Number(currentUser.id)} 
                  currentUser={currentUser}
                  socket={socket}
                  onReply={setReplyTo}
                  activeThreadId={activeThreadId}
                  onOpenThread={(threadId) => {
                      closeAllPanels();
                      setActiveThreadId(activeThreadId === threadId ? null : threadId);
                  }} 
                  showAvatar={showAvatar}
                  onShowToast={handleShowToast}
                  token={token}
                />
              </React.Fragment>
            );
          })}
          
          {/* New Message Notification */}
          {hasNewMessages && (
              <button 
                onClick={() => {
                    smartScrollToBottom(true);
                    setHasNewMessages(false);
                }}
                className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 z-40 animate-bounce transition-all hover:bg-blue-700 active:scale-95"
              >
                  <ArrowDownCircle size={18} />
                  <span className="text-sm font-bold">New Messages Below</span>
              </button>
          )}

          {/* Toast Notification - Light theme and auto-dismiss */}
          {toast && (
              <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white border border-gray-200 text-gray-800 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-6 z-50 animate-in slide-in-from-bottom-4 zoom-in-95 duration-300">
                  <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <span className="font-medium text-sm">{toast.message}</span>
                  </div>
                  {toast.onUndo && (
                      <button 
                        onClick={() => { toast.onUndo(); setToast(null); }} 
                        className="text-blue-600 font-bold hover:text-blue-700 uppercase text-[10px] tracking-widest bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-blue-100"
                      >
                          Undo
                      </button>
                  )}
                  <button 
                    onClick={() => setToast(null)} 
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={16} />
                  </button>
              </div>
          )}

          {/* Typing Indicator - Fixed height to avoid Layout Shift */}
          <div className="h-6 flex-none">
            {typingUsers.size > 0 && (
                <div className="text-xs text-gray-500 italic ml-12 mb-2 flex items-center gap-1 animate-pulse">
                  {Array.from(typingUsers).join(', ')} is typing...
                </div>
            )}
          </div>
          
          {/* 滚动锚点 */}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="flex-none bg-white dark:bg-gray-800 p-4 border-t border-gray-200 dark:border-gray-700 w-full z-20 transition-colors">
          {replyTo && (
              <div className="flex justify-between items-center bg-gray-100 dark:bg-gray-700/50 p-2 mb-2 rounded-lg text-sm border-l-4 border-blue-500 animate-in slide-in-from-bottom-2">
                  <span className="text-gray-600 dark:text-gray-300 truncate">Replying to <span className="font-bold text-gray-900 dark:text-white">{replyTo.user.username}</span></span>
                  <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white px-2">✕</button>
              </div>
          )}
          
          <div className="flex flex-col gap-2">
              {showRichText && (
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/50 p-1.5 rounded-lg w-max animate-in slide-in-from-bottom-2 transition-colors">
                      <button onClick={() => formatText('bold')} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 rounded" title="Bold"><Bold size={16} /></button>
                      <button onClick={() => formatText('italic')} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 rounded" title="Italic"><Italic size={16} /></button>
                      <button onClick={() => formatText('formatBlock', 'pre')} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 rounded" title="Code Block"><Code size={16} /></button>
                      <button onClick={() => formatText('insertUnorderedList')} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 rounded" title="List"><List size={16} /></button>
                  </div>
              )}
              
              <div className="flex gap-2 items-end">
                <div className="flex gap-1">
                    <button type="button" onClick={() => fileInputRef.current.click()} className="p-3 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition" title="Upload File">
                      <Paperclip size={20} />
                    </button>
                    <button type="button" onClick={toggleRichText} className={`p-3 rounded-full transition ${showRichText ? 'text-blue-600 dark:text-blue-400 bg-gray-100 dark:bg-gray-700' : 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`} title="Rich Text Formatting">
                      <FileText size={20} />
                    </button>
                </div>
                
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                
                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-2xl flex flex-col px-4 py-2 border border-transparent focus-within:border-blue-500/50 transition-all relative">
                  {mentionSearch !== null && (
                      <MentionList 
                        query={mentionSearch} 
                        onSelect={handleSelectMention} 
                        token={token} 
                      />
                  )}
                  {showRichText ? (
                      <RichInput
                        ref={textInputRef}
                        value={inputText}
                        onChange={handleTyping}
                        onEnter={handleSendMessage}
                        placeholder="Message... (@ to mention)"
                      />
                  ) : (
                      <input
                        className="flex-1 bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none h-[24px]"
                        placeholder="Message... (@ to mention)"
                        value={inputText}
                        onChange={(e) => handleTyping(e.target.value)}
                        onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) handleSendMessage(e); }}
                        autoFocus
                      />
                  )}
                </div>
                
                <button onClick={handleSendMessage} disabled={!inputText && !replyTo} className="p-3 bg-blue-600 rounded-full hover:bg-blue-500 disabled:opacity-50 disabled:bg-gray-400 dark:disabled:bg-gray-700 transition shadow-lg text-white">
                  <Send size={20} />
                </button>
              </div>
          </div>
        </div>

      </div>

      {/* --- 侧边栏 (Thread Sidebar) --- */}
      {activeThreadId && (
        <ThreadPanel 
            rootId={activeThreadId} 
            onClose={() => setActiveThreadId(null)}
            token={token}
            currentUser={currentUser}
            socket={socket}
            onShowToast={handleShowToast}
        />
      )}

      {/* --- 提及面板 --- */}
      {showMentions && (
          <MentionsPanel
            onClose={() => setShowMentions(false)}
            token={token}
            currentUser={currentUser}
            socket={socket}
            onJump={handleJumpToMessage}
          />
      )}

      {/* --- 收藏侧边栏 --- */}
      {showBookmarks && (
          <BookmarksPanel 
            onClose={() => setShowBookmarks(false)}
            token={token}
            currentUser={currentUser}
            socket={socket}
            onShowToast={handleShowToast}
          />
      )}

      {/* --- 搜索侧边栏 --- */}
      {showSearch && (
          <SearchPanel 
            onClose={() => setShowSearch(false)}
            token={token}
            currentUser={currentUser}
            socket={socket}
            onJump={handleJumpToMessage}
            onShowToast={handleShowToast}
          />
      )}

      {/* --- 文件中心 --- */}
      {showFileVault && (
          <FileVaultPanel 
            onClose={() => setShowFileVault(false)}
            token={token}
            socket={socket}
          />
      )}

    </div>
  );
}
