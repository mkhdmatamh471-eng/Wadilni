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
app.use(cors()); // يسمح للواجهة الخارجية بالاتصال
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ patients: [] }, null, 2));

// 2. إعداد واتساب (تعديل Puppeteer للعمل في السحابة)
let lastQR = "";

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

client.on('qr', (qr) => {
    lastQR = qr;
    console.log('✅ تم توليد كود QR جديد - افتح رابط /auth للمسح');
});

client.on('ready', () => {
    lastQR = "CONNECTED";
    console.log('✅ واتساب متصل وجاهز للإرسال!');
});

client.initialize();

// 3. إعداد رفع الصور (Multer)
const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- نقاط النهاية (Endpoints) ---

// أ - صفحة الباركود (التي طلبتها لتظهر في المتصفح الخاص بالنود)
app.get('/auth', async (req, res) => {
    if (lastQR === "CONNECTED") {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:#10b981;">✅ متصل بنجاح</h1>
                <p>واتساب عيادة الرحمن يعمل الآن بصورة سليمة.</p>
                <button onclick="window.location.reload()" style="padding:10px 20px; border-radius:10px; border:none; background:#3b82f6; color:white; cursor:pointer;">تحديث الحالة</button>
            </div>
        `);
    } else if (lastQR) {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:#1e293b;">ربط واتساب العيادة</h1>
                <p style="color:#64748b;">امسح الكود أدناه باستخدام واتساب الموبايل</p>
                <div style="background:white; display:inline-block; padding:20px; border-radius:20px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">
                    <img src="${qrImage}" width="250" />
                </div>
                <p style="color:#94a3b8; font-size:12px; mt-4">تنبيه: سيتم تحديث الصفحة تلقائياً كل 15 ثانية</p>
                <script>setTimeout(() => window.location.reload(), 15000);</script>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <div style="border:4px solid #f3f3f3; border-top:4px solid #3498db; border-radius:50%; width:40px; height:40px; animation:spin 2s linear infinite; margin:auto;"></div>
                <h2 style="color:#475569;">جاري تشغيل محرك الواتساب...</h2>
                <p>انتظر قليلاً حتى يظهر الكود، أو قم بتحديث الصفحة.</p>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                <script>setTimeout(() => window.location.reload(), 5000);</script>
            </div>
        `);
    }
});

// ب - مزامنة البيانات
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

// ج - رفع الصور (Handy Sensors / Clinical)
app.post('/api/upload/:id', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

// د - إرسال تذكير المواعيد
app.post('/api/send-reminder', async (req, res) => {
    const { phone, message } = req.body;
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('7')) cleanPhone = '967' + cleanPhone;
        const chatId = cleanPhone + "@c.us";
        
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// هـ - صفحة ترحيبية بسيطة
app.get('/', (req, res) => {
    res.send('🚀 DentalOS Server is Running! Go to /auth to connect WhatsApp.');
});

app.listen(PORT, () => console.log(`🚀 DentalOS Ready on port ${PORT}`));
