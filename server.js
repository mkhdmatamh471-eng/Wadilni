const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'dental_cloud_db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// الإعدادات الأساسية
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ patients: [] }, null, 2));

// إعداد واتساب (رقمك: +967785022014)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }
});

client.on('qr', (qr) => {
    console.log('يرجى مسح كود QR لربط رقمك (+967785022014):');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('✅ واتساب متصل وجاهز للإرسال!'));
client.initialize();

// --- نقاط النهاية (Endpoints) ---

// 1. مزامنة البيانات من الهاتف
app.post('/api/sync', (req, res) => {
    try {
        const localPatients = req.body.patients;
        let cloudDB = JSON.parse(fs.readFileSync(DB_FILE));
        
        localPatients.forEach(localP => {
            const idx = cloudDB.patients.findIndex(p => p.id === localP.id);
            if (idx > -1) cloudDB.patients[idx] = localP;
            else cloudDB.patients.push(localP);
        });

        fs.writeFileSync(DB_FILE, JSON.stringify(cloudDB, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. إرسال تذكير واتساب
app.post('/api/send-reminder', async (req, res) => {
    const { phone, message } = req.body;
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        // تحويل الرقم لصيغة واتساب الدولية لليمن
        if (cleanPhone.startsWith('7')) cleanPhone = '967' + cleanPhone;
        const chatId = cleanPhone + "@c.us";
        
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`🚀 DentalOS Ready on port ${PORT}`));
