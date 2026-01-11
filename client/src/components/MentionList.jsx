import React, { useEffect, useState } from 'react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export default function MentionList({ query, onSelect, token }) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch(`${SOCKET_URL}/api/users?search=${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setUsers(data));
  }, [query, token]);

  if (users.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-2 left-0 w-64 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden z-50">
      <div className="text-xs text-gray-500 px-3 py-1 bg-gray-50 border-b border-gray-200">
        Mention user...
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {users.map(user => (
          <li 
            key={user.id}
            onClick={() => onSelect(user)}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 cursor-pointer transition"
          >
            {user.avatar ? (
              <img src={user.avatar} className="w-6 h-6 rounded-full" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold">
                {user.username[0].toUpperCase()}
              </div>
            )}
            <span className="text-gray-800 text-sm">{user.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
