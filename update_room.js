const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/Room.tsx', 'utf8');

// 1. Imports
if (!code.includes('useAuth')) {
  code = code.replace(/import \{ socket, getServerTime \} from '\.\.\/lib\/socket';/, "import { socket, getServerTime } from '../lib/socket';\nimport { useAuth } from '../context/AuthContext';\nimport { useNavigate } from 'react-router-dom';");
  code = code.replace(/GripVertical, Link, Loader2 \} from 'lucide-react';/, "GripVertical, Link, Loader2, Repeat, Shuffle, Shield, ShieldOff, MoreVertical } from 'lucide-react';");
}

// 2. Component hooks
code = code.replace(/const playerRef = useRef/, `const { user } = useAuth();
  const navigate = useNavigate();
  const [allowGuestControl, setAllowGuestControl] = useState(true);
  const [loopMode, setLoopMode] = useState<'off' | 'track' | 'queue'>('off');
  const [isShuffle, setIsShuffle] = useState(false);
  const [volume, setVolume] = useState(100);
  const playerRef = useRef`);

// 3. Update join_room
code = code.replace(/socket\.emit\('join_room', \{ roomId \}\);/, `socket.emit('join_room', { roomId, user });`);

// 4. Handle room_state to update new states, and handle force_disconnect
const roomStateReplacement = `socket.on('room_state', (room: any) => {
      console.log('[Jammer] room_state received', room);
      setIsHost(room.hostId === socket.id || (user && room.hostId === user.id));
      setUsers(room.users || []);
      setQueue(room.queue || []);
      setHistory(room.history || []);
      setAllowGuestControl(room.allowGuestControl ?? true);
      setLoopMode(room.loopMode || 'off');
      setIsShuffle(room.isShuffle || false);
`;
code = code.replace(/socket\.on\('room_state', \(room: any\) => \{\n\s*console\.log\('\[Jammer\] room_state received', room\);\n\s*setIsHost\(room\.hostId === socket\.id\);\n\s*setUsers\(room\.users \|\| \[\]\);\n\s*setQueue\(room\.queue \|\| \[\]\);\n\s*setHistory\(room\.history \|\| \[\]\);\n/g, roomStateReplacement);

const disconnectListener = `
    socket.on('force_disconnect', (data) => {
      alert(data.reason === 'banned' ? 'You have been banned from this room.' : 'You have been kicked from this room.');
      navigate('/');
    });
`;
code = code.replace(/const join = \(\) => \{/g, disconnectListener + '\n    const join = () => {');
code = code.replace(/socket\.off\('queue_updated'\);/g, `socket.off('queue_updated');\n      socket.off('force_disconnect');`);

// 5. Volume, Loop, Shuffle UI
const volumeChangeLogic = `
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setVolume(val);
    if (playerRef.current) {
      playerRef.current.setVolume(val);
    }
  };

  const toggleLoop = () => {
    if (!isHost && !allowGuestControl) return;
    const nextMode = loopMode === 'off' ? 'track' : loopMode === 'track' ? 'queue' : 'off';
    socket.emit('host:set_loop', { roomId, mode: nextMode });
  };

  const toggleShuffle = () => {
    if (!isHost && !allowGuestControl) return;
    socket.emit('host:set_shuffle', { roomId, shuffle: !isShuffle });
  };

  const toggleGuestControl = () => {
    if (!isHost) return;
    socket.emit('host:toggle_guest_control', { roomId, allow: !allowGuestControl });
  };
`;
code = code.replace(/const handleSeekCommit = \(\) => \{/g, volumeChangeLogic + '\n  const handleSeekCommit = () => {');

// 6. People Tab UI and Dropdowns
// We need to add Kick/Ban UI.
const peopleTabReplacement = `
          ) : activeTab === 'people' ? (
            <div className="flex flex-col p-4 gap-2">
              {users.map((u, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
                  <div className="relative">
                    <img src={u.avatar || \`https://ui-avatars.com/api/?name=\${encodeURIComponent(u.username || 'User')}&background=random\`} alt={u.username || 'User'} className="w-10 h-10 rounded-full object-cover bg-black/40" />
                    {u.isHost && (
                      <div className="absolute -bottom-1 -right-1 bg-fuchsia-500 w-4 h-4 rounded-full border-2 border-[#131317] flex items-center justify-center" title="Host">
                        <span className="text-white text-[10px] leading-none mb-[1px]">★</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-white/90 truncate">{u.username || 'Anonymous Listener'} {user?.id === u.id && '(You)'}</h4>
                    <p className="text-[10px] text-white/40 tracking-widest uppercase mt-0.5">{u.isHost ? 'Host' : 'Listener'}</p>
                  </div>
                  {isHost && u.id !== socket.id && (
                    <div className="relative">
                       <button onClick={() => {
                         if (confirm('Kick this user?')) socket.emit('host:kick_user', { roomId, targetSocketId: u.id });
                       }} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded mr-2">Kick</button>
                       <button onClick={() => {
                         if (confirm('Ban this user?')) socket.emit('host:ban_user', { roomId, targetSocketId: u.id });
                       }} className="text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/40 px-2 py-1 rounded">Ban</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
`;
code = code.replace(/\) : activeTab === 'people' \? \([\s\S]*?\) : activeTab === 'history' \? \(/g, peopleTabReplacement + ") : activeTab === 'history' ? (");

// 7. Advanced Playback UI & restrictions
// restrict classes: \`\${!isHost && !allowGuestControl ? 'opacity-40 pointer-events-none' : ''}\`
const playbackControlsReplacement = `
            {/* Playback Controls */}
            <div className={\`flex items-center gap-6 justify-center flex-1 \${!isHost && !allowGuestControl ? 'opacity-40 pointer-events-none' : ''}\`}>
              <button 
                onClick={toggleShuffle}
                className={\`w-8 h-8 rounded-full flex items-center justify-center transition-colors \${isShuffle ? 'text-fuchsia-400 bg-white/10' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}\`}
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button onClick={playPrevious} className="text-white/70 hover:text-white transition-colors cursor-pointer group">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="group-hover:-translate-x-0.5 transition-transform">
                  <path d="M16 7L10 12L16 17V7Z" />
                  <path d="M10 7L4 12L10 17V7Z" />
                </svg>
              </button>
              
              <button 
                className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="ml-0.5">
                    <path d="M8 5V19M16 5V19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <Play className="w-6 h-6 ml-1 fill-current" />
                )}
              </button>

              <button onClick={playNext} className="text-white/70 hover:text-white transition-colors cursor-pointer group">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="group-hover:translate-x-0.5 transition-transform">
                  <path d="M8 7L14 12L8 17V7Z" />
                  <path d="M14 7L20 12L14 17V7Z" />
                </svg>
              </button>
              <button 
                onClick={toggleLoop}
                className={\`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors \${loopMode !== 'off' ? 'text-fuchsia-400 bg-white/10' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}\`}
              >
                <Repeat className="w-4 h-4" />
                {loopMode === 'track' && <span className="absolute -bottom-1 -right-1 text-[8px] bg-fuchsia-500 text-white rounded-full w-3 h-3 flex items-center justify-center font-bold border border-[#131317]">1</span>}
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex justify-end gap-4 items-center flex-1">
              <div className="flex items-center gap-2 group relative">
                <Volume2 className="text-white/30 hover:text-white/70 transition-colors cursor-pointer w-5 h-5" />
                <input 
                  type="range" min="0" max="100" value={volume} onChange={handleVolumeChange}
                  className="w-20 h-1 bg-white/20 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white cursor-pointer"
                />
              </div>
`;

code = code.replace(/\{\/\* Playback Controls \*\/\}\n\s*<div className="flex items-center gap-6 justify-center flex-1">[\s\S]*?\{\/\* Right Controls \*\/\}\n\s*<div className="flex justify-end gap-4 items-center flex-1">\n\s*<div className="flex items-center gap-4">[\s\S]*?<Volume2[^>]*\/>\n\s*<MoreHorizontal[^>]*\/>\n\s*<\/div>/, playbackControlsReplacement);


const sharedControlBtn = `
          {isHost && (
            <button onClick={toggleGuestControl} className={\`p-1.5 rounded-full transition-colors \${allowGuestControl ? 'bg-fuchsia-500/20 text-fuchsia-400' : 'bg-white/10 text-white/40'}\`} title={allowGuestControl ? "Guest control enabled" : "Guest control disabled"}>
              {allowGuestControl ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            </button>
          )}
          <div className="flex gap-2 items-center bg-white/5 px-3 py-1 rounded-full border border-white/10">`;

code = code.replace(/<div className="flex gap-2 items-center bg-white\/5 px-3 py-1 rounded-full border border-white\/10">/, sharedControlBtn);

code = code.replace(/disabled=\{!isHost\}/g, "disabled={!isHost && !allowGuestControl}");
code = code.replace(/\$\{!isHost \? 'cursor-not-allowed' : ''\}/g, "${!isHost && !allowGuestControl ? 'cursor-not-allowed' : ''}");

fs.writeFileSync('frontend/src/components/Room.tsx', code);
console.log('Fixed room');
