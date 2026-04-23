const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');

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

// 2. متغيرات تتبع الحالة
let pairingCode = ""; 
let isConnecting = false;
let connectionStatus = "DISCONNECTED"; // DISCONNECTED, CONNECTING, CONNECTED
const MY_PHONE = "967785022014"; 

// 3. إعداد محرك واتساب
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--no-zygote',
            '--single-process', '--disable-gpu'
        ] 
    }
});

// 4. معالجة أحداث الواتساب (التركيز على الكود فقط)
client.on('qr', async () => {
    connectionStatus = "CONNECTING";
    
    // طلب كود الربط إذا لم يكن موجوداً
    if (!pairingCode && !isConnecting) {
        isConnecting = true;
        console.log('⏳ جاري طلب كود الربط الرقمي لعيادة الرحمن...');
        
        setTimeout(async () => {
            try {
                pairingCode = await client.requestPairingCode(MY_PHONE);
                console.log(`✅ كود الربط الجاهز: ${pairingCode}`);
            } catch (err) {
                console.error('❌ فشل توليد الكود:', err);
                pairingCode = ""; // إعادة المحاولة في الدورة القادمة
            } finally {
                isConnecting = false;
            }
        }, 6000); // تأخير لضمان جاهزية الصفحة
    }
});

client.on('ready', () => {
    connectionStatus = "CONNECTED";
    pairingCode = ""; 
    console.log('🚀 واتساب العيادة متصل الآن!');
});

client.on('disconnected', () => {
    connectionStatus = "DISCONNECTED";
    pairingCode = "";
    client.initialize();
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

// أ - صفحة الربط بالكود (حصرياً)
app.get('/auth', async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (connectionStatus === "CONNECTED") {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px; background:#f0fdf4; padding:50px; border-radius:30px; max-width:500px; margin-left:auto; margin-right:auto; border:1px solid #bbf7d0;">
                <h1 style="color:#10b981; font-size:40px;">✅ متصل</h1>
                <p style="color:#166534; font-size:18px;">واتساب العيادة يعمل الآن.</p>
                <button onclick="window.location.href='/'" style="padding:15px 30px; border-radius:15px; border:none; background:#10b981; color:white; cursor:pointer; font-weight:bold; margin-top:20px;">العودة للوحة التحكم</button>
            </div>
        `);
    }

    if (pairingCode) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px; padding:20px;">
                <h2 style="color:#1e293b; margin-bottom:10px;">ربط واتساب عيادة الرحمن</h2>
                <p style="color:#64748b;">أدخل هذا الكود في هاتفك لربط النظام بالواتساب:</p>
                
                <div style="background:#ffffff; display:inline-block; padding:40px 60px; border:5px solid #3b82f6; border-radius:35px; font-size:65px; font-weight:900; letter-spacing:12px; color:#1e40af; font-family:'Courier New', monospace; margin:30px 0; box-shadow:0 20px 40px rgba(59,130,246,0.15);">
                    ${pairingCode}
                </div>

                <div style="background:#eff6ff; padding:20px; border-radius:20px; max-width:450px; margin:0 auto; text-align:right; border:1px solid #dbeafe;">
                    <h4 style="margin-top:0; color:#1e40af;">📌 طريقة التفعيل من هاتفك:</h4>
                    <ol style="color:#1e3a8a; font-size:14px; line-height:1.8;">
                        <li>افتح تطبيق <b>واتساب</b>.</li>
                        <li>اذهب إلى <b>الإعدادات</b> > <b>الأجهزة المرتبطة</b>.</li>
                        <li>اضغط على <b>ربط جهاز</b>.</li>
                        <li>اختر <b>"الربط برقم الهاتف بدلاً من ذلك"</b> في الأسفل.</li>
                        <li>أدخل الكود الموضح أعلاه.</li>
                    </ol>
                </div>
                <script>setTimeout(() => window.location.reload(), 20000);</script>
            </div>
        `);
    }

    // حالة الانتظار
    res.send(`
        <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
            <div style="border:6px solid #f3f3f3; border-top:6px solid #3b82f6; border-radius:50%; width:60px; height:60px; animation:spin 1s linear infinite; margin:auto;"></div>
            <h2 style="color:#475569; margin-top:25px;">جاري توليد كود الربط...</h2>
            <p style="color:#94a3b8;">يرجى الانتظار ثواني بسيطة، سيظهر الكود هنا تلقائياً.</p>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            <script>setTimeout(() => window.location.reload(), 4000);</script>
        </div>
    `);
});

// [نقاط النهاية الأخرى: sync, upload, send-reminder تبقى كما هي في الكود السابق]
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
    res.send('🦷 DentalOS Server is active. Access /auth to link WhatsApp.');
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
