// client/src/App.jsx
import React, { useState, useEffect } from 'react';
import ChatRoom from './components/ChatRoom';
import { Lock, User } from 'lucide-react';

const API_URL = (import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001') + '/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
  
  // 简单的登录表单状态
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Login failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  if (!token || !user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-900">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-xl w-96 space-y-6">
          <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">NexusChat</h1>
          <div className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
              <input 
                type="text" 
                placeholder="Username (admin / user)" 
                className="w-full bg-gray-50 p-3 pl-10 rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={username} onChange={e => setUsername(e.target.value)}
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
              <input 
                type="password" 
                placeholder="Password (123456)" 
                className="w-full bg-gray-50 p-3 pl-10 rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={password} onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded font-bold transition">
            Enter Nexus
          </button>
        </form>
      </div>
    );
  }

  return <ChatRoom token={token} currentUser={user} onLogout={handleLogout} />;
}
