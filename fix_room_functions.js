const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/Room.tsx', 'utf8');

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

if (!code.includes('toggleGuestControl')) {
  code = code.replace(/const handleSeekCommit = \(/, volumeChangeLogic + '\n  const handleSeekCommit = (');
}

// Remove MoreVertical import
code = code.replace(/MoreVertical\s*\} from 'lucide-react';/, "} from 'lucide-react';");
code = code.replace(/,\s*MoreVertical/, "");

// Replace the unused volume logic in UI if it's there
code = code.replace(/<Volume2 className="text-white\/30 hover:text-white\/70 transition-colors cursor-pointer w-5 h-5" \/>\n\s*<MoreHorizontal className="text-white\/30 hover:text-white\/70 transition-colors cursor-pointer w-5 h-5" \/>/, `<div className="flex items-center gap-2 group relative">
                <Volume2 className="text-white/30 hover:text-white/70 transition-colors cursor-pointer w-5 h-5" />
                <input 
                  type="range" min="0" max="100" value={volume} onChange={handleVolumeChange}
                  className="w-20 h-1 bg-white/20 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white cursor-pointer"
                />
              </div>`);

fs.writeFileSync('frontend/src/components/Room.tsx', code);
console.log('Fixed Room functions');
