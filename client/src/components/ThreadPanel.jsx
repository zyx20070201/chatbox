import React, { useEffect, useState, useRef } from 'react';
import { X, Send, FileText, Bold, Italic, Code, List, Link as LinkIcon } from 'lucide-react';
import MessageBubble from './MessageBubble';
import MentionList from './MentionList';
import DateDivider from './DateDivider';
import RichInput from './RichInput';
import { checkIsSameDay, escapeHtml } from '../utils';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function ThreadPanel({ rootId, onClose, token, currentUser, socket, onShowToast }) {
  const [rootMsg, setRootMsg] = useState(null);
  const [replies, setReplies] = useState([]);
  const [inputText, setInputText] = useState('');
  const [showRichText, setShowRichText] = useState(false);
  
  // Mention State
  const [mentionSearch, setMentionSearch] = useState(null);
  const [mentionIds, setMentionIds] = useState(new Set());

  const endRef = useRef(null);
  const textInputRef = useRef(null);

  // 加载 Thread 数据
  useEffect(() => {
    fetch(`${SOCKET_URL}/api/messages/${rootId}/thread`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.root) {
            setRootMsg(data.root);
            setReplies(data.replies || []);
            setTimeout(() => endRef.current?.scrollIntoView(), 100);
        }
      });
  }, [rootId, token]);

  // 监听新回复 (实时更新 Sidebar)
  useEffect(() => {
    if (!socket) return;

    const handleNewMsg = (msg) => {
      if (!msg) return;
      setReplies(prev => {
        // 1. 如果是直接回复根消息
        if (Number(msg.parentId) === Number(rootId)) {
           setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
           return [...prev, msg];
        }
        
        // 2. 或者是回复当前 Thread 中的某条子消息 (支持无限层级挂载)
        const isReplyToExisting = prev.some(m => m && Number(m.id) === Number(msg.parentId));
        if (isReplyToExisting) {
           setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
           return [...prev, msg];
        }
        
        return prev;
      });
    };

    const handleDeleteMsg = ({ messageId }) => {
       if (!messageId) return;
       // 1. Root Message
       if (Number(rootId) === Number(messageId)) {
           setRootMsg(prev => prev ? ({ ...prev, isDeleted: true }) : null);
       }
       // Update Root Quote
       setRootMsg(prev => {
           if (prev && prev.parent && Number(prev.parent.id) === Number(messageId)) {
               return { ...prev, parent: { ...prev.parent, isDeleted: true } };
           }
           return prev;
       });

       // 2. Replies
       setReplies(prev => {
           // Mark deleted
           let newReplies = prev.map(m => {
               if (m && Number(m.id) === Number(messageId)) {
                   return { ...m, isDeleted: true };
               }
               return m;
           });
           
           // Update Quotes
           newReplies = newReplies.map(m => {
               if (m && m.parent && Number(m.parent.id) === Number(messageId)) {
                   return { ...m, parent: { ...m.parent, isDeleted: true } };
               }
               return m;
           });
           
           return newReplies;
       });
    };

    const handleUpdateMsg = (updatedMsg) => {
        if (!updatedMsg) return;
        if (Number(rootId) === Number(updatedMsg.id)) {
            setRootMsg(updatedMsg);
        }
        setReplies(prev => prev.map(m => {
            if (!m) return m;
            if (m.id === updatedMsg.id) return updatedMsg;
            if (m.parent && m.parent.id === updatedMsg.id) {
                return { ...m, parent: updatedMsg };
            }
            return m;
        }));
    };

    const handleReactionAdded = ({ messageId, reaction }) => {
        const updateReaction = (msg) => {
            if (!msg || msg.id !== messageId) return msg;
            return { ...msg, reactions: [...(msg.reactions || []), reaction] };
        };
        if (Number(rootId) === Number(messageId)) {
            setRootMsg(prev => updateReaction(prev));
        }
        setReplies(prev => prev.map(updateReaction));
    };

    const handleReactionRemoved = ({ messageId, emoji, userId }) => {
        const removeReaction = (msg) => {
            if (!msg || msg.id !== messageId) return msg;
            return {
                ...msg,
                reactions: (msg.reactions || []).filter(r => !(r.userId === userId && r.emoji === emoji))
            };
        };
        if (Number(rootId) === Number(messageId)) {
            setRootMsg(prev => removeReaction(prev));
        }
        setReplies(prev => prev.map(removeReaction));
    };

    const handleMyMentionUpdate = (updatedMention) => {
        if (!updatedMention) return;
        const updateMentionInMsg = (msg) => {
            if (!msg) return msg;
            if (msg.id === updatedMention.messageId && msg.mentions) {
                return {
                    ...msg,
                    mentions: msg.mentions.map(m => m.id === updatedMention.id ? updatedMention : m)
                };
            }
            return msg;
        };

        setRootMsg(prev => updateMentionInMsg(prev));
        setReplies(prev => prev.map(updateMentionInMsg));
    };

    const handleRestoreMsg = (restoredMsg) => {
        if (!restoredMsg) return;
        // 1. Root Message
        if (Number(rootId) === Number(restoredMsg.id)) {
            setRootMsg(restoredMsg);
        }
        // Update Root Quote
        setRootMsg(prev => {
            if (prev && prev.parent && Number(prev.parent.id) === Number(restoredMsg.id)) {
                return { ...prev, parent: restoredMsg };
            }
            return prev;
        });

        // 2. Replies
        setReplies(prev => {
            let newReplies = [...prev];
            const exists = prev.some(m => m && m.id === restoredMsg.id);
            
            if (exists) {
                newReplies = prev.map(m => (m && m.id === restoredMsg.id) ? restoredMsg : m);
            } else {
                const parentExists = restoredMsg && (Number(restoredMsg.parentId) === Number(rootId) || prev.some(m => m && m.id === restoredMsg.parentId));
                if (parentExists) {
                    newReplies.push(restoredMsg);
                    newReplies.sort((a, b) => {
                        const t1 = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                        const t2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                        return t1 - t2;
                    });
                }
            }
            
            // Update Quotes
            return newReplies.map(m => {
                 if (m && m.parent && Number(m.parent.id) === Number(restoredMsg.id)) {
                     return { ...m, parent: restoredMsg };
                 }
                 return m;
            });
        });
    };


    socket.on('new_message', handleNewMsg);
    socket.on('message_deleted', handleDeleteMsg);
    socket.on('message_updated', handleUpdateMsg);
    socket.on('message_restored', handleRestoreMsg);
    socket.on('message_reaction_added', handleReactionAdded);
    socket.on('message_reaction_removed', handleReactionRemoved);
    socket.on('my_mention_updated', handleMyMentionUpdate);

    return () => {
        socket.off('new_message', handleNewMsg);
        socket.off('message_deleted', handleDeleteMsg);
        socket.off('message_updated', handleUpdateMsg);
        socket.off('message_restored', handleRestoreMsg);
        socket.off('message_reaction_added', handleReactionAdded);
        socket.off('message_reaction_removed', handleReactionRemoved);
        socket.off('my_mention_updated', handleMyMentionUpdate);
    };
  }, [socket, rootId]); 

  const handleSend = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    
    let contentToSend = inputText;
    let isEmpty = false;

    if (showRichText) {
        const cleanText = inputText.replace(/<[^>]*>/g, '').trim();
        isEmpty = !cleanText;
    } else {
        contentToSend = escapeHtml(inputText.trim());
        isEmpty = !inputText.trim();
    }

    if (isEmpty) return;
    
    socket.emit('send_message', {
      content: contentToSend,
      replyToId: rootId,
      type: 'text',
      mentionUserIds: Array.from(mentionIds)
    });
    setInputText('');
    setMentionIds(new Set());
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
  };

  const toggleRichText = () => {
      if (showRichText) {
          const div = document.createElement('div');
          div.innerHTML = inputText;
          setInputText(div.innerText);
      } else {
          setInputText(escapeHtml(inputText));
      }
      setShowRichText(!showRichText);
  };

  const handleSelectMention = (user) => {
      if (textInputRef.current) {
          textInputRef.current.execCommand('insertHTML', `&nbsp;<strong>@${user.username}</strong>&nbsp;`);
      }
      setMentionIds(prev => new Set(prev).add(user.id));
      setMentionSearch(null);
  };

  const formatText = (command) => {
      if (textInputRef.current) {
          textInputRef.current.execCommand(command);
          textInputRef.current.focus();
      }
  };

  if (!rootMsg) return <div className="w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-4 text-gray-800 dark:text-gray-200">Loading...</div>;

  return (
    <div className="w-96 flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-30 transition-all overflow-hidden">
      {/* Header */}
      <div className="flex-none flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <h3 className="font-bold text-gray-800 dark:text-gray-200">Thread</h3>
        <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><X size={20} /></button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
        {/* Root Message (大卡片) */}
        <div className="opacity-80 scale-95 origin-left mb-6 border-b border-gray-200 dark:border-gray-700 pb-4">
             <MessageBubble 
                message={rootMsg} 
                isMe={Number(rootMsg.userId) === Number(currentUser.id)} 
                currentUser={currentUser} 
                socket={socket} 
                showAvatar={true} 
                onReply={()=>{}} 
                onShowToast={onShowToast} 
                onRemove={() => onClose()}
                token={token}
             />
        </div>

        {/* Replies */}
        {replies.map((msg, idx) => {
            if (!msg || !msg.user) return null;
            const prevDate = idx === 0 ? rootMsg.createdAt : (replies[idx - 1]?.createdAt || rootMsg.createdAt);
            const showDivider = !checkIsSameDay(msg.createdAt, prevDate);
            
            return (
              <React.Fragment key={msg.id}>
                {showDivider && <DateDivider date={msg.createdAt} />}
                <MessageBubble 
                    message={msg} 
                    isMe={Number(msg.userId) === Number(currentUser.id)} 
                    currentUser={currentUser} 
                    socket={socket} 
                    showAvatar={true}
                    onReply={() => { setInputText(`@${msg.user.username} `) }} 
                    onShowToast={onShowToast}
                    onRemove={() => setReplies(prev => prev.filter(m => m && m.id !== msg.id))}
                    token={token}
                />
              </React.Fragment>
            );
        })}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="flex-none p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 relative flex flex-col gap-2 transition-colors">
        {showRichText && (
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/50 p-1.5 rounded-lg w-max mb-1">
                <button onClick={() => formatText('bold')} className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 rounded" title="Bold"><Bold size={14} /></button>
                <button onClick={() => formatText('italic')} className="p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded" title="Italic"><Italic size={14} /></button>
                <button onClick={() => formatText('formatBlock', 'pre')} className="p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded" title="Code Block"><Code size={14} /></button>
                <button onClick={() => formatText('insertUnorderedList')} className="p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded" title="List"><List size={14} /></button>
            </div>
        )}

        <div className="relative">
            {mentionSearch !== null && (
                <div className="absolute bottom-full left-4 mb-1">
                    <MentionList 
                        query={mentionSearch} 
                        onSelect={handleSelectMention} 
                        token={token} 
                    />
                </div>
            )}
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2">
            <button type="button" onClick={toggleRichText} className={`p-1 rounded-full transition ${showRichText ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'}`} title="Format">
                <FileText size={16} />
            </button>
            {showRichText ? (
                <div className="text-gray-900 dark:text-white flex-1">
                    <RichInput
                        ref={textInputRef}
                        value={inputText}
                        onChange={handleTyping}
                        onEnter={handleSend}
                        placeholder="Reply to thread... (@ to mention)"
                    />
                </div>
            ) : (
                <input
                    className="flex-1 bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none h-[24px]"
                    placeholder="Reply to thread... (@ to mention)"
                    value={inputText}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) handleSend(e); }}
                />
            )}
            <button onClick={handleSend} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"><Send size={16} /></button>
            </div>
        </div>
      </div>
    </div>
  );
}
