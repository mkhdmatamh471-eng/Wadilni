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

// إنشاء المجلدات وقاعدة البيانات إذا لم تكن موجودة
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ patients: [] }, null, 2));

// 2. متغيرات تتبع الحالة
let lastQR = "";
let pairingCode = ""; 
let isConnecting = false;
const usePairingCode = true; 
const MY_PHONE = "967785022014"; // رقم هاتف عيادة الرحمن

// 3. إعداد محرك واتساب (Puppeteer مناسب للسحابة)
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

// 4. معالجة أحداث الواتساب
client.on('qr', async (qr) => {
    lastQR = qr; // حفظ الـ QR كاحتياط
    
    // إذا كان الربط بالكود مفعلاً ولم نطلب كوداً بعد
    if (usePairingCode && !client.info && !pairingCode && !isConnecting) {
        isConnecting = true;
        console.log('⏳ جاري طلب كود الربط الرقمي...');
        
        // تأخير بسيط لضمان استقرار الجلسة قبل طلب الكود
        setTimeout(async () => {
            try {
                pairingCode = await client.requestPairingCode(MY_PHONE);
                console.log(`✅ كود الربط الخاص بك هو: ${pairingCode}`);
            } catch (err) {
                console.error('❌ فشل توليد كود الربط:', err);
            } finally {
                isConnecting = false;
            }
        }, 5000); 
    }
});

client.on('ready', () => {
    lastQR = "CONNECTED";
    pairingCode = ""; 
    console.log('🚀 واتساب عيادة الرحمن متصل وجاهز!');
});

client.on('disconnected', () => {
    lastQR = "";
    pairingCode = "";
    client.initialize(); // إعادة التشغيل تلقائياً عند الفصل
});

client.initialize();

// 5. إعداد رفع الصور (Multer)
const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- نقاط النهاية (Endpoints) ---

// أ - صفحة الربط (Authentication Page)
app.get('/auth', async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    if (lastQR === "CONNECTED") {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h1 style="color:#10b981;">✅ متصل بنجاح</h1>
                <p>واتساب العيادة يعمل الآن بصورة سليمة على السحابة.</p>
                <button onclick="window.location.href='/'" style="padding:12px 25px; border-radius:15px; border:none; background:#3b82f6; color:white; cursor:pointer; font-weight:bold;">العودة للرئيسية</button>
            </div>
        `);
    }

    if (pairingCode) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px; padding:20px;">
                <h1 style="color:#1e293b;">ربط واتساب العيادة</h1>
                <p style="color:#64748b;">أدخل الكود أدناه في هاتفك (الأجهزة المرتبطة > ربط برقم الهاتف):</p>
                <div style="background:#f8fafc; display:inline-block; padding:30px 50px; border:4px solid #3b82f6; border-radius:25px; font-size:50px; font-weight:900; letter-spacing:10px; color:#1e40af; font-family:monospace; margin:20px 0; box-shadow:0 10px 20px rgba(59,130,246,0.2);">
                    ${pairingCode}
                </div>
                <div style="color:#475569; font-size:14px; background:#fff7ed; padding:15px; border-radius:15px; max-width:400px; margin:20px auto; border:1px solid #ffedd5;">
                    💡 <b>خطوات الربط في موبايلك:</b><br>
                    1. افتح واتساب > الإعدادات.<br>
                    2. الأجهزة المرتبطة > ربط جهاز.<br>
                    3. اختر "الربط برقم الهاتف بدلاً من ذلك".
                </div>
                <script>setTimeout(() => window.location.reload(), 30000);</script>
            </div>
        `);
    }

    // حالة الانتظار أو الباركود كبديل
    if (lastQR) {
        const qrImage = await QRCode.toDataURL(lastQR);
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1>مسح كود QR</h1>
                <p>يمكنك مسح الكود أو الانتظار قليلاً ليظهر كود الربط النصي...</p>
                <img src="${qrImage}" width="280" style="border:10px solid white; box-shadow:0 10px 25px rgba(0,0,0,0.1); border-radius:20px;" />
                <script>setTimeout(() => window.location.reload(), 15000);</script>
            </div>
        `);
    }

    res.send(`
        <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
            <div style="border:5px solid #f3f3f3; border-top:5px solid #3498db; border-radius:50%; width:50px; height:50px; animation:spin 1s linear infinite; margin:auto;"></div>
            <h2 style="color:#475569; margin-top:20px;">جاري تشغيل محرك الواتساب...</h2>
            <p>سيظهر كود الربط خلال لحظات، يرجى الانتظار.</p>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            <script>setTimeout(() => window.location.reload(), 5000);</script>
        </div>
    `);
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ج - رفع الصور
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
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/', (req, res) => {
    res.send('🚀 DentalOS Server is Running! Go to /auth to connect WhatsApp.');
});

app.listen(PORT, () => console.log(`🚀 DentalOS Ready on port ${PORT}`));
