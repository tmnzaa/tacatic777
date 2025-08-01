// Ambil metadata grup terbaru
const groupMetadata = await sock.groupMetadata(from);
const participants = groupMetadata?.participants || [];

// Deteksi semua kemungkinan ID bot
const botIdRaw = sock?.user?.id || '';
const botJIDs = [
  botIdRaw,
  botIdRaw.split(':')[0] + '@s.whatsapp.net',
  botIdRaw.split(':')[0] + '@net',
];

// Temukan info bot & pengirim
const botInfo = participants.find(p => botJIDs.includes(p.id));
const senderInfo = participants.find(p => p.id === sender);

// Cek admin
const isAdmin = senderInfo?.admin === 'admin' || senderInfo?.admin === 'superadmin';
const isBotAdmin = botInfo?.admin === 'admin' || botInfo?.admin === 'superadmin';

// Cek owner grup & bot
const groupOwner = groupMetadata.owner || participants.find(p => p.admin === 'superadmin')?.id || '';
const isGroupOwner = sender === groupOwner;
const isBotOwner = OWNER_BOT.includes(sender);
const isOwner = isBotOwner || isGroupOwner;

// DEBUG
console.log('──── DEBUG ADMIN CHECK ────');
console.log('Bot Raw ID:', botIdRaw);
console.log('Possible Bot JIDs:', botJIDs);
console.log('Group Participants:', participants.map(p => p.id));
console.log('Bot Info:', botInfo?.id || '❌ NOT FOUND');
console.log('Bot Admin:', isBotAdmin);
console.log('Sender Admin:', isAdmin);
console.log('Group Owner:', groupOwner);
console.log('Sender Owner:', isOwner);
console.log('────────────────────────────');
