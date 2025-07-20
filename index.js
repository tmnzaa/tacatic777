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
let dbCache = {}

// Validasi isi file JSON
function isValidJson(content) {
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

// Cek apakah file grup.json ada
if (!fs.existsSync(dbFile)) {
  console.warn('⚠️ File grup.json tidak ditemukan, membuat file baru...')
  fs.writeFileSync(dbFile, '{}', 'utf-8')
} else {
  try {
    const raw = fs.readFileSync(dbFile, 'utf-8').trim()
    if (isValidJson(raw)) {
      dbCache = JSON.parse(raw)
    } else {
      console.error('❌ File grup.json rusak! Tidak diubah agar data tidak hilang.')
    }
  } catch (err) {
    console.error('❌ Gagal membaca grup.json:', err.message)
  }
}

// Fungsi simpan DB
function saveDB() {
  try {
    if (Object.keys(dbCache).length > 0) {
      fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2), 'utf-8')
    } else {
      console.warn('⚠️ dbCache kosong, simpan dibatalkan agar tidak kosongkan file.')
    }
  } catch (err) {
    console.error('❌ Gagal menyimpan DB:', err.message)
  }
}

let qrShown = false

// === Cache DB agar tidak delay ===
try {
  const raw = fs.readFileSync(dbFile, 'utf-8').trim()
  dbCache = raw === '' ? {} : JSON.parse(raw)
} catch (e) {
  dbCache = {}
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
  const fitur = dbCache[update.id]
  if (!fitur) return

  try {
    const metadata = await sock.groupMetadata(update.id)

    for (const jid of update.participants) {
     const contact = await sock.onWhatsApp(jid)
const name = contact?.[0]?.notify || `@${jid.split('@')[0]}`
      const groupName = metadata.subject
      const tagUser = `@${jid.split('@')[0]}`
      const imagePath = './ronaldo.jpg'

      // 🟢 WELCOME
     if (update.action === 'add' && fitur.welcome) {
  const teks = `👋 *${name}* (${tagUser}) baru saja bergabung ke *${groupName}*.\n\n📜 _"Aturan bukan buat membatasi, tapi buat menjaga kenyamanan bersama."_ \n\nSebelum mulai interaksi atau promosi, silakan *baca rules di deskripsi grup*.\n\n📌 Di sini kita jaga suasana tetap rapi dan nyaman. Hormati aturan, hargai sesama.\n\n— Bot Taca standby. 🤖`

  await sock.sendMessage(update.id, {
    image: fs.readFileSync(imagePath),
    caption: teks,
    mentions: [jid]
  })
}


      // 🔴 LEAVE
      if (update.action === 'remove' && fitur.leave) {
  const teks = `👋 *${name}* telah meninggalkan grup.\n\n_"Tidak semua perjalanan harus diselesaikan bersama. Terima kasih sudah pernah menjadi bagian dari *${groupName}*."_`

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
  db = isValidJson(raw) ? JSON.parse(raw) : {}
} catch (e) {
  console.error('❌ Gagal baca atau parse grup.json:', e.message || e)
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
