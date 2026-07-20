const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/Room.tsx', 'utf8');

// The block we want to replace starts with:
// <div className="flex items-center gap-6">
// and ends with:
// </button>
// </div>

const newControls = `
          <div className={\`flex items-center gap-6 \${!isHost && !allowGuestControl ? 'opacity-40 pointer-events-none' : ''}\`}>
             <button 
               onClick={toggleShuffle}
               disabled={!isHost && !allowGuestControl}
               className={\`transition-colors \${isShuffle ? 'text-primary' : 'text-on-surface-variant hover:text-primary'} disabled:opacity-30 disabled:hover:text-on-surface-variant\`}
             >
               <Shuffle className="w-6 h-6" />
             </button>
             
             <button 
               onClick={playPrevious}
               disabled={(!isHost && !allowGuestControl) || history.length === 0}
               className="text-on-surface-variant hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-on-surface-variant"
             >
               <span className="material-symbols-outlined text-3xl"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg></span>
             </button>

             <button 
               onClick={togglePlay}
               disabled={!videoId || (!isHost && !allowGuestControl)}
               className="w-16 h-16 flex-shrink-0 rounded-full bg-primary text-background flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_30px_rgba(255,255,255,0.6)] hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none"
             >
               {isPlaying ? (
                 <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
               ) : (
                 <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><polygon points="5 3 19 12 5 21 5 3"/></svg>
               )}
             </button>

             <button 
               onClick={playNext}
               disabled={(!isHost && !allowGuestControl) || (!currentTrack && queue.length === 0)}
               className="text-on-surface-variant hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-on-surface-variant"
             >
               <span className="material-symbols-outlined text-3xl"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></span>
             </button>

             <button 
               onClick={toggleLoop}
               disabled={!isHost && !allowGuestControl}
               className={\`relative transition-colors \${loopMode !== 'off' ? 'text-primary' : 'text-on-surface-variant hover:text-primary'} disabled:opacity-30 disabled:hover:text-on-surface-variant\`}
             >
               <Repeat className="w-6 h-6" />
               {loopMode === 'track' && <span className="absolute -bottom-1 -right-2 text-[10px] bg-primary text-background rounded-full w-4 h-4 flex items-center justify-center font-bold">1</span>}
             </button>
          </div>
`;

code = code.replace(/<div className="flex items-center gap-6">[\s\S]*?<\/button>\n\s*<\/div>/, newControls);

fs.writeFileSync('frontend/src/components/Room.tsx', code);
console.log('Fixed playback controls');
