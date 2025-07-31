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

function isValidJson(content) {
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

if (!fs.existsSync(dbFile)) {
  console.warn('⚠️ File grup.json tidak ditemukan, membuat file kosong...')
  fs.writeFileSync(dbFile, '{}', 'utf-8')
}

try {
  const raw = fs.readFileSync(dbFile, 'utf-8').trim()
  dbCache = isValidJson(raw) ? JSON.parse(raw) : {}
} catch (err) {
  console.error('❌ File grup.json rusak! Reset ke kosong.')
  fs.writeFileSync(dbFile, '{}', 'utf-8')
  dbCache = {}
}

// Simpan DB ke file
function saveDB() {
  try {
    fs.writeJsonSync(dbFile, dbCache, { spaces: 2 })
  } catch (err) {
    console.error('❌ Gagal menyimpan DB:', err.message)
  }
}

let qrShown = false

// === File DND ===
const dndFile = './dnd.json'

// Buat file dnd.json jika belum ada
if (!fs.existsSync(dndFile)) {
  fs.writeJsonSync(dndFile, {}) // kosong default
}

// Load data DND
let dndData = {}
try {
  dndData = fs.readJsonSync(dndFile)
} catch (err) {
  console.error('❌ File dnd.json rusak! Reset ke kosong.')
  dndData = {}
  fs.writeJsonSync(dndFile, {})
}

function saveDnd() {
  fs.writeJsonSync(dndFile, dndData, { spaces: 2 })
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

  // ✅ Fungsi cek admin
  async function isAdmin(sock, jid, sender) {
    try {
      const metadata = await sock.groupMetadata(jid)
      const admins = metadata.participants.filter(p => p.admin)
      return admins.some(p => p.id === sender)
    } catch {
      return false
    }
  }

  // 📥 Message handler
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return
    if (!msg.key.remoteJid || !msg.key.id || msg.key.id.startsWith('BAE5') || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const sender = msg.key.participant || msg.key.remoteJid
    const pesan = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    const isCmd = pesan.startsWith('.')
    const isGroup = from.endsWith('@g.us')
    const isDndActive = dndData[from]
    const senderNumber = sender.split('@')[0]

    let db = dbCache
    const fitur = db[from]

    // ✅ Perintah DND
    if (isGroup && isCmd && pesan === '.dnd on') {
      const admin = await isAdmin(sock, from, sender)
      if (!admin) return sock.sendMessage(from, { text: '❌ Hanya admin yang bisa aktifkan DND.' }, { quoted: msg })
      dndData[from] = true
      saveDnd()
      return sock.sendMessage(from, { text: '✅ Mode DND diaktifkan. Member tidak bisa gunakan fitur.' }, { quoted: msg })
    }

    if (isGroup && isCmd && pesan === '.dnd off') {
      const admin = await isAdmin(sock, from, sender)
      if (!admin) return sock.sendMessage(from, { text: '❌ Hanya admin yang bisa matikan DND.' }, { quoted: msg })
      delete dndData[from]
      saveDnd()
      return sock.sendMessage(from, { text: '☑️ Mode DND dinonaktifkan.' }, { quoted: msg })
    }

    // ❌ Blok fitur jika DND aktif dan bukan admin
    if (isGroup && isCmd && isDndActive) {
      const admin = await isAdmin(sock, from, sender)
      if (!admin) {
        return sock.sendMessage(from, {
          text: `🚫 Mode DND aktif. @${senderNumber} tidak diizinkan pakai fitur.`,
          mentions: [sender]
        }, { quoted: msg })
      }
    }

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
      if (!global.handleGrup) global.handleGrup = require('./grup')
      if (!global.handlePrivate) global.handlePrivate = require('./private')

      global.handleGrup(sock, msg)
      global.handlePrivate(sock, msg)

    } catch (err) {
      console.error('💥 Error handle pesan:', err)
    }
  })
}

// 🛠 Global error
process.on('unhandledRejection', err => {
  console.error('💥 Unhandled Rejection:', err)
})

startBot()
