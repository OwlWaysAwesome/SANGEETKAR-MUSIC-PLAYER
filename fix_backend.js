const fs = require('fs');
let code = fs.readFileSync('backend/src/index.ts', 'utf8');

const helper = `\nconst checkControlPermission = (room: any, socketId: string): boolean => {
  const user = room.users.find((u: any) => u.id === socketId);
  if (!user) return false;
  return user.isHost || room.allowGuestControl;
};\n\n`;

if (!code.includes('checkControlPermission')) {
  code = code.replace("io.on('connection', (socket) => {", helper + "io.on('connection', (socket) => {");
}

// Replace standard auth checks
code = code.replace(/const user = room\.users\.find\(u => u\.id === socket\.id\);\n\s*if \(!user \|\| !user\.isHost\) \{?.*?\}?/g, 'if (!checkControlPermission(room, socket.id)) return;');
code = code.replace(/const user = room\.users\.find\(u => u\.id === socket\.id\);\n\s*if \(!user \|\| !user\.isHost\) return;/g, 'if (!checkControlPermission(room, socket.id)) return;');

// For host:queue_add and host:queue_add_bulk which have a special if block:
code = code.replace(/if \(room\.users\.length > 0\) \{\n\s*const user = room\.users\.find\(u => u\.id === socket\.id\);\n\s*if \(!user \|\| !user\.isHost\) \{\n\s*console\.log[^}]*\}\n\s*\} else \{\n\s*console\.log[^}]*\}\n\s*\}/g, `if (room.users.length > 0 && !checkControlPermission(room, socket.id)) { return; }`);

fs.writeFileSync('backend/src/index.ts', code);
console.log('Fixed auth checks');
