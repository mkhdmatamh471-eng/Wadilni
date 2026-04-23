const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'dental_cloud_db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// 1. الإعدادات الأساسية
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ patients: [] }, null, 2));

// 2. متغيرات الحالة (يجب تعريفها قبل استخدامها في الأحداث)
let lastQR = "";
let pairingCode = ""; 
const usePairingCode = true; // تفعيل الربط عبر الكود النصي

// 3. إعداد واتساب
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ] 
    }
});

// حدث توليد الكود
client.on('qr', async (qr) => {
    lastQR = qr; // حفظ الـ QR كخيار احتياطي
    
    if (usePairingCode && !client.info) {
        const phoneNumber = "967785022014"; 
        try {
            pairingCode = await client.requestPairingCode(phoneNumber);
            console.log(`✅ كود الربط هو: ${pairingCode}`);
        } catch (err) {
            console.error('خطأ في توليد كود الربط:', err);
        }
    }
    console.log('✅ تم تحديث كود الربط/QR - افتح رابط /auth للمسح');
});

client.on('ready', () => {
    lastQR = "CONNECTED";
    pairingCode = ""; // تصفير الكود بعد النجاح
    console.log('✅ واتساب متصل وجاهز للإرسال!');
});

client.initialize();

// 4. إعداد رفع الصور
const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- نقاط النهاية (Endpoints) ---

app.get('/auth', async (req, res) => {
    if (lastQR === "CONNECTED") {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px; background:#f0fdf4; padding:40px; border-radius:30px; max-width:500px; margin-left:auto; margin-right:auto;">
                <h1 style="color:#10b981;">✅ متصل بنجاح</h1>
                <p>واتساب عيادة الرحمن (+967785022014) يعمل الآن.</p>
                <button onclick="window.location.href='/'" style="padding:10px 20px; border-radius:10px; border:none; background:#3b82f6; color:white; cursor:pointer;">العودة</button>
            </div>
        `);
    } else if (pairingCode) {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:#1e293b;">الربط عبر كود التحقق</h1>
                <p>أدخل الكود التالي في هاتفك لربط الواتساب:</p>
                <div style="background:#f8fafc; display:inline-block; padding:20px 40px; border:3px dashed #3b82f6; border-radius:20px; font-size:40px; font-weight:900; letter-spacing:10px; color:#1e40af; font-family:monospace;">
                    ${pairingCode}
                </div>
                <div style="margin-top:20px; color:#64748b; font-size:14px; line-height:1.6;">
                    <p><b>طريقة الإدخال:</b><br>واتساب > الأجهزة المرتبطة > ربط جهاز > الربط برقم الهاتف</p>
                </div>
                <p style="color:#94a3b8; font-size:11px; margin-top:30px;">سيتم تحديث الصفحة كل 60 ثانية لضمان صلاحية الكود</p>
                <script>setTimeout(() => window.location.reload(), 60000);</script>
            </div>
        `);
    } else if (lastQR) {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1>مسح كود QR (الخيار الثاني)</h1>
                <img src="${qrImage}" width="250" />
                <p>إذا لم تستخدم الكود النصي، امسح الـ QR.</p>
                <script>setTimeout(() => window.location.reload(), 60000);</script>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h2>جاري تجهيز كود الربط...</h2>
                <p>يرجى الانتظار ثواني.</p>
                <script>setTimeout(() => window.location.reload(), 5000);</script>
            </div>
        `);
    }
});

// [بقية نقاط النهاية: sync, upload, send-reminder تبقى كما هي]
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload/:id', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

app.post('/api/send-reminder', async (req, res) => {
    const { phone, message } = req.body;
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('7')) cleanPhone = '967' + cleanPhone;
        const chatId = cleanPhone + "@c.us";
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/', (req, res) => {
    res.send('🚀 DentalOS Server is Running! Go to /auth to connect WhatsApp.');
});

app.listen(PORT, () => console.log(`🚀 DentalOS Ready on port ${PORT}`));
