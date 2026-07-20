import React from 'react';
import { useNavigate } from 'react-router-dom';

const Home: React.FC = () => {
  const navigate = useNavigate();

  const createRoom = () => {
    const roomId = Math.random().toString(36).substring(2, 9);
    navigate(`/room/${roomId}`);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full bg-surface p-8 rounded-2xl shadow-xl text-center border border-gray-800">
        <h1 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
          Jammer Dashboard
        </h1>
        <p className="text-gray-400 mb-8">Welcome! Create a new room to start jamming.</p>
        
        <button 
          onClick={createRoom}
          className="w-full py-3 px-6 bg-primary hover:bg-blue-600 transition-colors rounded-xl font-semibold text-white shadow-lg shadow-blue-500/30"
        >
          Create New Room
        </button>
      </div>
    </div>
  );
};

export default Home;
