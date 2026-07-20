const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/Room.tsx', 'utf8');

code = code.replace(/import \{ Play, Disc3, Search, Plus, ListMusic, Trash2, Volume2, MoreHorizontal, GripVertical, Link, Loader2, Repeat, Shuffle, Shield, ShieldOff \} from 'lucide-react';/, "import { Play, Disc3, Search, Plus, ListMusic, Trash2, Volume2, GripVertical, Link, Loader2, Repeat, Shuffle, Shield, ShieldOff } from 'lucide-react';");

fs.writeFileSync('frontend/src/components/Room.tsx', code);
