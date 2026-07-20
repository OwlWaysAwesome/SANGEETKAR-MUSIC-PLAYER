import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../config';

const Lobby: React.FC = () => {
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const createRoom = async () => {
    setIsCreating(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/rooms`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        navigate(`/room/${data.roomId}`);
      } else {
        console.error('Failed to create room');
        setIsCreating(false);
      }
    } catch (e) {
      console.error('Error creating room', e);
      setIsCreating(false);
    }
  };

  const joinRoom = (code: string) => {
    if (code.trim()) {
      navigate(`/room/${code.trim()}`);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden font-body-md antialiased text-on-surface">
      
      {/* Ambient Background Glows */}
      <div className="ambient-mesh"></div>

      {/* Main Card */}
      <div className="relative z-10 w-full max-w-[448px] bg-[#111115]/60 backdrop-blur-[24px] border border-white/5 rounded-xl px-12 py-10 shadow-2xl flex flex-col items-center">
        
        {/* Header */}
        <h1 className="text-white text-[16px] tracking-[0.35em] uppercase mb-10 text-center font-playfair font-normal">
          SANGEETKAR
        </h1>
        
        {/* Primary Glow Button */}
        <button 
          onClick={createRoom}
          disabled={isCreating}
          className="w-full bg-white text-[#2F3131] font-semibold text-sm py-3.5 rounded-lg flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] transition-all duration-300 disabled:opacity-70"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          {isCreating ? 'Creating Room...' : 'Create New Room'}
        </button>

        {/* OR Divider */}
        <div className="flex items-center justify-center w-full gap-5 my-8">
          <div className="h-px bg-white/10 flex-1"></div>
          <span className="text-[#E4E1E7]/80 text-[13px] font-medium font-montserrat">Or</span>
          <div className="h-px bg-white/10 flex-1"></div>
        </div>

        {/* Join Room Input Group */}
        <form 
          className="relative w-full"
          onSubmit={(e) => {
            e.preventDefault();
            joinRoom(roomCode);
          }}
        >
          <input 
            type="text" 
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="Enter Room Code" 
            className="w-full bg-gradient-to-r from-[#282828] to-[#1B171A] border border-[#282828] rounded-[24px] py-3.5 pl-6 pr-14 text-[#F8F0F0] placeholder:text-[#E4E1E7]/80 focus:outline-none focus:ring-1 focus:ring-white/10 transition-all duration-300 text-[13px] font-medium font-montserrat shadow-inner"
          />
          <button 
            type="submit"
            disabled={!roomCode.trim()}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/60 hover:bg-white/80 text-black rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </form>

      </div>
    </div>
  );
};

export default Lobby;
