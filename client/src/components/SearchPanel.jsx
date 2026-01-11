import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import MessageBubble from './MessageBubble';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function SearchPanel({ onClose, token, currentUser, socket, onJump, onShowToast }) {
  const [query, setQuery] = useState('');
  const [sender, setSender] = useState('');
  const [date, setDate] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (sender) params.append('sender', sender);
      if (date) params.append('date', date);

      const res = await fetch(`${SOCKET_URL}/api/messages/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-96 flex flex-col bg-white border-l border-gray-200 shadow-2xl z-30 transition-all">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="font-bold text-gray-800">Search History</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={20} /></button>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="p-4 border-b border-gray-200 space-y-3">
        <input 
          className="w-full bg-gray-100 text-gray-900 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500 border border-gray-200"
          placeholder="Search content..."
          value={query} onChange={e => setQuery(e.target.value)}
        />
        <input 
          className="w-full bg-gray-100 text-gray-900 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500 border border-gray-200"
          placeholder="Sender username..."
          value={sender} onChange={e => setSender(e.target.value)}
        />
        <input 
          type="date"
          className="w-full bg-gray-100 text-gray-900 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500 border border-gray-200"
          value={date} onChange={e => setDate(e.target.value)}
        />
        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded text-white text-sm font-bold flex items-center justify-center gap-2 transition">
          <Search size={16} /> Search
        </button>
      </form>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {loading && <div className="text-center text-gray-500">Searching...</div>}
        {!loading && results.length === 0 && (
            <div className="text-center text-gray-500">No results found.</div>
        )}
        {results.map(msg => (
          <div 
            key={msg.id} 
            className="cursor-pointer hover:bg-gray-100 p-2 rounded border border-transparent hover:border-gray-200 transition"
            onClick={() => onJump(msg.id)}
          >
              {/* 这里使用简化的预览，不使用 MessageBubble 以避免复杂的交互嵌套，或者使用 MessageBubble 但禁用部分功能? 
                  需求是 "点击具体的消息，可以高亮定位"。
                  MessageBubble 包含太多按钮。Search 结果通常是列表。
                  但我需要保持一致性吗？用户可能想在搜索结果里直接点赞？
                  通常搜索只是导航。
                  但是如果 SearchPanel 只是列表，那么不用传 onShowToast。
                  之前的代码只是渲染了一个 div 列表。
                  所以我其实不需要传 onShowToast 给 SearchPanel，因为它没有渲染 MessageBubble。
                  Wait, check previous `SearchPanel.jsx` content.
              */}
             {/* 简化版 Message Preview */}
             <div className="flex items-center gap-2 mb-1">
                 <span className="font-bold text-gray-800 text-xs">{msg.user.username}</span>
                 <span className="text-xs text-gray-500">{new Date(msg.createdAt).toLocaleDateString()}</span>
             </div>
             <div className="text-sm text-gray-600 line-clamp-3">
                 {msg.content || '[Attachment]'}
             </div>
          </div>
        ))}
      </div>
    </div>
  );
}
