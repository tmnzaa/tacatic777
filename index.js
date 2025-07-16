const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const P = require('pino')
const { Boom } = require('@hapi/boom')
const schedule = require('node-schedule')
const fs = require('fs-extra')
const axios = require('axios')

// === File Database ===
const dbFile = './grup.json'
let db = {}

if (!fs.existsSync(dbFile)) {
  console.error('❌ File grup.json tidak ditemukan! Harap buat file kosong terlebih dahulu.')
  process.exit(1)
}

try {
  const raw = fs.readFileSync(dbFile, 'utf-8').trim()
  db = raw === '' ? {} : JSON.parse(raw)
} catch (err) {
  console.error('❌ File grup.json rusak atau tidak bisa dibaca!')
  console.error('⛔ Harap perbaiki manual file tersebut.')
  process.exit(1)
}

let qrShown = false

// === Cache DB agar tidak delay ===
let dbCache = {}
try {
  const raw = fs.readFileSync(dbFile, 'utf-8').trim()
  dbCache = raw === '' ? {} : JSON.parse(raw)
} catch (e) {
  dbCache = {}
}

// Simpan DB ke file
function saveDB() {
  fs.writeJsonSync(dbFile, dbCache, { spaces: 2 })
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !qrShown) {
      qrShown = true
      console.log('\n📲 Scan QR untuk login:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      console.log('✅ Bot berhasil terhubung ke WhatsApp!')
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      const reconnect = code !== DisconnectReason.loggedOut
      console.log('❌ Terputus. Reconnect:', reconnect)
      qrShown = false
      if (reconnect) startBot()
    }
  })

  // 📥 Message handler
sock.ev.on('messages.upsert', async ({ messages }) => {
  const msg = messages[0]
  if (!msg.message) return
  if (!msg.key.remoteJid || msg.key.id.startsWith('BAE5') || msg.key.fromMe) return

  const from = msg.key.remoteJid
  const sender = msg.key.participant || msg.key.remoteJid
let db = dbCache

  const fitur = db[from]

  // ✅ ANTIPOLLING
  if (fitur?.antipolling && msg.message.pollCreationMessage) {
    console.log('🚫 Deteksi polling dari:', sender)

    await sock.sendMessage(from, {
      text: `❌ @${sender.split('@')[0]} dilarang kirim polling di grup ini.`,
      mentions: [sender]
    })

    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: false,
          id: msg.key.id,
          participant: sender
        }
      })
      console.log('✅ Polling berhasil dihapus.')
    } catch (err) {
      console.error('❌ Gagal hapus polling:', err)
    }
    return
  }

  // Handler lain
  try {
    require('./grup')(sock, msg)
    require('./private')(sock, msg)
  } catch (err) {
    console.error('💥 Error handle pesan:', err)
  }
})

sock.ev.on('group-participants.update', async (update) => {
 let db = dbCache
  const fitur = db[update.id]
  if (!fitur) return

  try {
    const metadata = await sock.groupMetadata(update.id)

    for (const jid of update.participants) {
  const name = metadata.participants.find(p => p.id === jid)?.notify || `@${jid.split('@')[0]}`
      const groupName = metadata.subject
      const tagUser = `@${jid.split('@')[0]}`
      const imagePath = './ronaldo.jpg'

      // 🟢 WELCOME
      if (update.action === 'add' && fitur.welcome) {
        const teks = `*${name}* (${tagUser}) selamat datang di grup *${groupName}*!`
        await sock.sendMessage(update.id, {
          image: fs.readFileSync(imagePath),
          caption: teks,
          mentions: [jid]
        })
      }

      // 🔴 LEAVE
      if (update.action === 'remove' && fitur.leave) {
        const teks = `*${name}* (${tagUser}) telah keluar dari grup *${groupName}*.`
        await sock.sendMessage(update.id, {
          image: fs.readFileSync(imagePath),
          caption: teks,
          mentions: [jid]
        })
      }
    }
  } catch (err) {
    console.error('❌ Error welcome/leave:', err)
  }
}) 

schedule.scheduleJob('* * * * *', async () => {
  const now = new Date()
  const jam = now.toTimeString().slice(0, 5).replace(':', '.').padStart(5, '0')
  let db = {}
  
  try {
    const raw = fs.readFileSync(dbFile, 'utf-8').trim()
    db = raw === '' ? {} : JSON.parse(raw)
  } catch (e) {
    console.error('❌ Gagal baca dbFile:', e)
    return
  }

  for (const id in db) {
    const fitur = db[id]
    if (!fitur) continue

    try {
      const metadata = await sock.groupMetadata(id).catch(e => {
        console.warn(`⚠️ Gagal ambil metadata grup ${id}: ${e.message || e}`)
        return null
      })
      if (!metadata) continue

      const botNumber = sock.user?.id?.split(':')[0] + '@s.whatsapp.net'
      const botParticipant = metadata.participants?.find(p => p.id === botNumber)
      const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin'

      if (!isBotAdmin) {
        console.log(`❌ Bot bukan admin di grup ${id}, skip.`)
        continue
      }

      // ✅ Buka grup
if (fitur.openTime && fitur.openTime === jam) {
  await sock.groupSettingUpdate(id, 'not_announcement').catch(e => {
    console.warn(`⚠️ Gagal buka grup ${id}: ${e.message || e}`)
  })
  await sock.sendMessage(id, {
    text: `✅ Grup dibuka otomatis jam *${jam}*`
  }).catch(() => { })

  console.log(`✅ Grup ${id} dibuka jam ${jam}`)
  delete fitur.openTime // ⬅️ Tambahkan ini
}

// 🔒 Tutup grup
if (fitur.closeTime && fitur.closeTime === jam) {
  await sock.groupSettingUpdate(id, 'announcement').catch(e => {
    console.warn(`⚠️ Gagal tutup grup ${id}: ${e.message || e}`)
  })
  await sock.sendMessage(id, {
    text: `🔒 Grup ditutup otomatis jam *${jam}*`
  }).catch(() => { })

  console.log(`🔒 Grup ${id} ditutup jam ${jam}`)
  delete fitur.closeTime // ⬅️ Tambahkan ini
}

    } catch (err) {
      console.error(`❌ Gagal update setting grup ${id}:`, err.message || err)
      // Jangan kirim ke grup, cukup log ke konsol  
    }
  }

  // Simpan perubahan DB
  try {
  await fs.writeJson(dbFile, db, { spaces: 2 })
} catch (e) {
  console.error('❌ Gagal simpan file DB:', e.message || e)
}
})
}

// 🛠 Global error
process.on('unhandledRejection', err => {
  console.error('💥 Unhandled Rejection:', err)
})

startBot()
