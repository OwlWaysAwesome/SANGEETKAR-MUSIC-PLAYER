const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/Room.tsx', 'utf8');

// Update room_state
code = code.replace(/socket\.on\('room_state', \(room: any\) => \{\n\s*console\.log\('\[Jammer\] room_state received:', room\);\n\s*if \(!room\) return;/, "socket.on('room_state', (room: any) => {\n      console.log('[Jammer] room_state received:', room);\n      if (!room) return;\n      setAllowGuestControl(room.allowGuestControl ?? true);\n      setLoopMode(room.loopMode || 'off');\n      setIsShuffle(room.isShuffle || false);");

// Volume
code = code.replace(/<div className="flex items-center gap-2 group relative">\n\s*<Volume2[^>]*\/>\n\s*<input\n\s*type="range" min="0" max="100" value=\{volume\} onChange=\{handleVolumeChange\}[\s\S]*?<\/div>/, `<div className="flex items-center gap-2 group relative">
                <Volume2 className="text-white/30 hover:text-white/70 transition-colors cursor-pointer w-5 h-5" />
                <input 
                  type="range" min="0" max="100" value={volume} onChange={handleVolumeChange}
                  className="w-20 h-1 bg-white/20 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white cursor-pointer"
                />
              </div>`);

fs.writeFileSync('frontend/src/components/Room.tsx', code);
